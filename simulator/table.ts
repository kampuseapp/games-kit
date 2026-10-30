// A game at a table, kept as Kampuse keeps one: the seats, whose turn it is, the turn's clock, who left,
// and the state the rules return, with every step recorded so the game can be replayed at the end. Seats
// can be played by bots, which pick at random from the rules' moves().

import { endWithoutLeave, hostRefusal, stepSeed, type Shown, type Step } from '../src/judge'
import { LIMITS, jsonBytes, type HostMsg, type Player, type Result } from '../src/protocol'
import type { GameMeta } from './games'
import { RulesRunner } from './rules-client'
import type { RunnerRes } from './runner'

/** A side, or the one watching. */
export type Who = number | 'w'

export type Level = 'info' | 'warn' | 'error'

export type TableOut = {
  /** Sends a message to a player's screen (or the watcher's). */
  send(who: Who, msg: HostMsg): void
  log(level: Level, who: string, text: string, data?: unknown): void
  /** Something on the table changed: draw it again. */
  changed(): void
}

/** How long a bot thinks before it moves (ms). */
const BOT_MS = 700

export class Table {
  state: unknown = null
  shown: Shown | null = null
  seq = 0
  turn: number[] = []
  over: Result | null = null
  /** When the turn's clock runs out (ms), or null. */
  ends: number | null = null
  /** Every step the rules took, to replay. */
  steps: Step[] = []
  /** Whether the game, replayed from its steps in fresh rules, came out the same. */
  replay: 'checking' | 'same' | 'different' | null = null
  /** The rules failed and the game cannot go on. */
  broken: string | null = null
  /** The sides a bot plays. */
  readonly bots = new Set<number>()
  private idle: number[]
  private recent: number[][]
  private seed = (Math.random() * 2 ** 32) >>> 0
  private queue: Promise<void> = Promise.resolve()
  private botTimer = 0
  private closed = false

  constructor(
    readonly meta: GameMeta,
    readonly seats: Player[],
    private runner: RulesRunner,
    private clock: boolean,
    private out: TableOut,
  ) {
    this.idle = seats.map(() => 0)
    this.recent = seats.map(() => [])
  }

  /** One thing at a time, in order, as messages come. */
  private run(fn: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(fn).catch((e: unknown) => {
      this.broken = e instanceof Error ? e.message : String(e)
      this.out.log('error', 'rules', this.broken)
      this.out.changed()
    })
    return this.queue
  }

  private name = (side: number) => this.seats[side]?.name ?? `side ${side}`
  private seedFor = () => stepSeed(this.seed, this.steps.length)
  private seatsIn = () => this.seats.map((s) => s.in)

  start(): Promise<void> {
    return this.run(async () => {
      await this.step({ op: 'start', seed: this.seedFor(), now: Date.now() }, null)
    })
  }

  /** The table is gone (a new game): no more bot moves or clocks. */
  close() {
    this.closed = true
    clearTimeout(this.botTimer)
  }

  /** A move from a screen (or a bot): passed to the rules if it is that side's turn and within the limits. */
  move(who: Who, move: unknown, by: 'screen' | 'bot' = 'screen'): Promise<void> {
    return this.run(async () => {
      if (who === 'w') return this.refuse(who, 'You are watching.')
      if (this.broken) return this.refuse(who, 'The game hit a problem.')
      const why = hostRefusal({ turn: this.turn, over: this.over, in: this.seatsIn() }, who)
      if (why) return this.refuse(who, why)
      let bytes: number
      try {
        bytes = jsonBytes(move)
      } catch {
        this.out.log('warn', this.name(who), 'The move is not JSON (a loop inside it?).')
        return this.refuse(who, 'That move cannot be sent.')
      }
      if (bytes > LIMITS.moveBytes) {
        this.out.log('warn', this.name(who), `The move is ${bytes} bytes. The limit is ${LIMITS.moveBytes}.`)
        return this.refuse(who, 'That move is too big.')
      }
      const now = Date.now()
      this.recent[who] = this.recent[who].filter((at) => now - at < 1000)
      if (this.recent[who].length >= LIMITS.movesPerSecond) {
        this.out.log('warn', this.name(who), `More than ${LIMITS.movesPerSecond} moves in a second: refused.`)
        return this.refuse(who, 'Too fast.')
      }
      this.recent[who].push(now)
      if (by === 'bot') this.out.log('info', `🤖 ${this.name(who)}`, 'move', move)
      if (await this.step({ op: 'move', side: who, move, seed: this.seedFor(), now }, who)) this.idle[who] = 0
    })
  }

  /** A player left the table. */
  leave(side: number): Promise<void> {
    return this.run(() => this.gone(side, 'left the table.'))
  }

  /** Turns the clock on or off. */
  setClock(on: boolean) {
    this.clock = on
    this.restartClock()
    this.broadcast()
  }

  /** A bot takes a seat, or gives it back. */
  setBot(side: number, on: boolean) {
    if (on) this.bots.add(side)
    else this.bots.delete(side)
    this.out.log('info', this.name(side), on ? 'is played by a bot (a random move from rules.moves).' : 'is played by hand again.')
    this.nextBot()
    this.out.changed()
  }

  /** Called a few times a second: the clock running out for whoever's turn it is. */
  tick() {
    if (this.ends === null || Date.now() < this.ends || this.over || this.broken) return
    const due = [...this.turn]
    this.ends = null
    void this.run(async () => {
      for (const side of due) {
        if (this.over || !this.seats[side]?.in) continue
        this.idle[side]++
        if (this.idle[side] >= LIMITS.idleTurns) {
          await this.gone(side, `let the clock run out ${LIMITS.idleTurns} turns in a row, which counts as leaving.`)
          continue
        }
        const has = this.runner.has
        if (has?.timeout || has?.moves) {
          this.out.log('info', this.name(side), has.timeout ? 'ran out of time (rules.timeout).' : 'ran out of time: a random move from rules.moves is played.')
          await this.step({ op: 'timeout', side, seed: this.seedFor(), now: Date.now() }, null)
        } else await this.gone(side, 'ran out of time, which counts as leaving (the rules have no timeout() or moves()).')
      }
    })
  }

  /** What a screen is told about the game now, or null before the first view. */
  viewFor(who: Who): HostMsg | null {
    if (!this.shown) return null
    const view = who === 'w' ? this.shown.watcher : this.shown.views[who]
    return { t: 'view', view, turn: this.turn, ends: this.ends, now: Date.now(), seq: this.seq, over: this.over }
  }

  private refuse(who: Who, reason: string) {
    this.out.send(who, { t: 'refused', reason })
  }

  private async gone(side: number, why: string) {
    const seat = this.seats[side]
    if (!seat?.in || this.over) return
    seat.in = false
    this.bots.delete(side)
    this.out.log('info', seat.name, why)
    for (const who of this.everyone()) this.out.send(who, { t: 'players', players: this.seats })
    if (this.runner.has?.leave) {
      await this.step({ op: 'leave', side, seed: this.seedFor(), now: Date.now() }, null)
      return
    }
    this.over = endWithoutLeave(this.seatsIn())
    this.turn = []
    this.seq++
    this.restartClock()
    this.out.log('info', 'kit', 'The game ended: everyone still in wins (the rules have no leave()).')
    this.broadcast()
  }

  /** Asks the rules to take a step; true when they took it. */
  private async step(step: Step, from: number | null): Promise<boolean> {
    let res: RunnerRes
    try {
      res = await this.runner.ask({ op: 'step', step, state: this.state, players: this.seats.length })
    } catch (e) {
      // Stuck (stopped by the time limit) or crashed: the step is dropped and the state stays as it was.
      res = { id: 0, ok: false, notes: [], error: e instanceof Error ? e.message : String(e) }
    }
    for (const note of res.notes) this.out.log(note.level, 'rules', note.text)
    if (!res.ok) {
      this.out.log('error', 'rules', res.error)
      if (from !== null) this.refuse(from, 'The game hit a problem.')
      if (step.op !== 'move') {
        this.broken = res.error
        this.out.changed()
      }
      return false
    }
    if (res.refused !== undefined) {
      const bot = from !== null && this.bots.has(from)
      this.out.log(bot ? 'error' : 'info', this.name(from ?? 0), bot ? `rules.moves listed a move that rules.move turned down: ${res.refused}` : `move turned down: ${res.refused}`, step.op === 'move' ? step.move : undefined)
      if (from !== null) this.refuse(from, res.refused)
      return false
    }
    this.state = res.state
    this.shown = res.shown!
    this.steps.push(step)
    this.seq++
    this.turn = this.shown.turn
    this.over = this.shown.over
    for (const side of this.turn)
      if (!this.seats[side]?.in) this.out.log('warn', 'rules', `rules.turn lists side ${side}, who has left. Skip them in leave(), or the clock will run out on them.`)
    this.restartClock()
    this.broadcast()
    if (this.over) void this.checkReplay()
    return true
  }

  private restartClock() {
    this.ends = this.clock && this.turn.length && !this.over ? Date.now() + this.meta.turnSeconds * 1000 : null
  }

  private everyone(): Who[] {
    return [...this.seats.map((s) => s.side), 'w']
  }

  private broadcast() {
    for (const who of this.everyone()) {
      const msg = this.viewFor(who)
      if (msg) this.out.send(who, msg)
    }
    this.nextBot()
    this.out.changed()
  }

  /** When it is a bot's turn: it thinks a moment, then plays a random move from rules.moves. */
  private nextBot() {
    clearTimeout(this.botTimer)
    const side = this.turn.find((s) => this.bots.has(s) && this.seats[s]?.in)
    if (side === undefined || this.over || this.broken || this.closed || !this.runner.has?.moves) return
    const seq = this.seq
    this.botTimer = window.setTimeout(async () => {
      if (this.closed || this.seq !== seq) return
      try {
        const res = await this.runner.ask({ op: 'moves', state: this.state, side })
        for (const note of res.notes) this.out.log(note.level, 'rules', note.text)
        if (!res.ok) return this.out.log('error', 'rules', res.error)
        if (this.closed || this.seq !== seq) return
        const list = res.moves ?? []
        if (!list.length) return this.out.log('error', 'rules', `It is ${this.name(side)}'s turn, but rules.moves lists nothing for them.`)
        void this.move(side, list[Math.floor(Math.random() * list.length)], 'bot')
      } catch (e) {
        this.out.log('error', 'rules', e instanceof Error ? e.message : String(e))
      }
    }, BOT_MS)
  }

  /** The finished game played again from its steps, in rules loaded afresh: it must end the same. */
  private async checkReplay() {
    this.replay = 'checking'
    this.out.changed()
    const fresh = new RulesRunner(this.runner.url)
    try {
      const res = await fresh.ask({ op: 'replay', steps: this.steps, players: this.seats.length }, 10_000)
      if (res.ok && res.final === JSON.stringify(this.state)) {
        this.replay = 'same'
        this.out.log('info', 'kit', `Replay check: the game played again from its ${this.steps.length} steps ends the same. ✓`)
      } else {
        this.replay = 'different'
        this.out.log(
          'error',
          'kit',
          res.ok
            ? 'Replay check: played again from its steps, the game ends differently. The rules depend on something besides the state and ctx (Math.random, Date.now, or a variable kept outside the state).'
            : `Replay check failed: ${res.error}`,
        )
      }
    } catch (e) {
      this.replay = 'different'
      this.out.log('error', 'kit', `Replay check failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      fresh.terminate()
      this.out.changed()
    }
  }
}
