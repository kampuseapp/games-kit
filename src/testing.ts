// Testing a game's rules without a browser: play a game move by move in an ordinary test (node:test, Vitest,
// anything), with the same checks Kampuse makes. A rules bug throws a RulesError; a refused move comes back
// as { refused }.
//
//   const game = startGame(rules, { players: 2, seed: 7 })
//   game.move(game.turn[0], { cell: 4 })
//   assert.equal(game.over, null)
//
//   const report = fuzz(rules, { games: 500 })   // needs moves()
//   assert.deepEqual(report.problems, [])

import { RulesError, endWithoutLeave, fuzz as fuzzRules, hostRefusal, legalMoves, play, replay, rulesOf, status, stepSeed, viewOf, type FuzzOptions, type FuzzReport, type Note, type Step } from './judge'
import type { Result } from './protocol'
import type { Rules } from './rules'

export { RulesError, type FuzzOptions, type FuzzReport, type Note, type Step }

/** A game being played in a test. */
export type TestGame<State, Move, View> = {
  /** What the rules keep, now. */
  readonly state: State
  /** Whose move it is (sides). */
  readonly turn: number[]
  /** How it ended, once it has. */
  readonly over: Result | null
  /** Sides still at the table. */
  readonly in: boolean[]
  /** Warnings so far: Math.random or Date.now used, slow calls, big views. Errors throw instead. */
  readonly notes: Note[]
  /** Every step the rules took. */
  readonly steps: Step[]
  /** A move, as a screen would send it: refused by Kampuse (not your turn, game over) or by the rules, or taken. */
  move(side: number, move: Move): { ok: true } | { refused: string }
  /** The turn's clock runs out for a side: timeout(), else a random move from moves(), else they leave. */
  timeout(side: number): void
  /** A side leaves: leave(), else the game ends and everyone still in wins. */
  leave(side: number): void
  /** What a side sees (null: a watcher). */
  view(side: number | null): View
  /** The moves a side could make (needs moves()). */
  moves(side: number): Move[]
  /**
   * Whether the game, played again from its steps, ends the same. (In the same rules module: the simulator's
   * check loads them afresh, which also catches variables kept outside the state.)
   */
  replays(): boolean
}

/** Starts a game at a pretend table of `players`. The same seed gives the same game. */
export function startGame<State, Move, View>(rules: Rules<State, Move, View>, opts: { players: number; seed?: number }): TestGame<State, Move, View> {
  const r = rulesOf(rules, []).rules
  const players = opts.players
  if (!Number.isInteger(players) || players < 1 || players > 4) throw new Error('players must be 1 to 4.')
  const seed = opts.seed ?? 1
  const notes: Note[] = []
  const steps: Step[] = []
  const seatsIn = Array.from({ length: players }, () => true)
  let state: unknown = null
  let turn: number[] = []
  let over: Result | null = null
  let now = 0

  /** Plays a step: null when the rules took it, else why they refused. */
  const apply = (step: Step): string | null => {
    const out = play(r, step, state, players, notes)
    if ('refused' in out) return out.refused
    state = out.state
    steps.push(step)
    ;({ turn, over } = status(r, state, players, notes))
    return null
  }
  const next = () => ({ seed: stepSeed(seed, steps.length), now: (now += 1000) })

  apply({ op: 'start', ...next() })

  const game: TestGame<State, Move, View> = {
    get state() {
      return state as State
    },
    get turn() {
      return [...turn]
    },
    get over() {
      return over
    },
    get in() {
      return [...seatsIn]
    },
    notes,
    steps,
    move(side, move) {
      const why = hostRefusal({ turn, over, in: seatsIn }, side)
      if (why) return { refused: why }
      const refused = apply({ op: 'move', side, move, ...next() })
      return refused === null ? { ok: true } : { refused }
    },
    timeout(side) {
      if (!turn.includes(side) || over) throw new Error(`It is not side ${side}'s turn, so their clock can't run out.`)
      if (r.timeout || r.moves) apply({ op: 'timeout', side, ...next() })
      else game.leave(side)
    },
    leave(side) {
      if (!seatsIn[side] || over) return
      seatsIn[side] = false
      if (r.leave) apply({ op: 'leave', side, ...next() })
      else {
        over = endWithoutLeave(seatsIn)
        turn = []
      }
    },
    view: (side) => viewOf(r, state, side, notes) as View,
    moves(side) {
      const list = legalMoves(r, state, side, notes)
      if (!list) throw new RulesError('The rules have no moves().')
      return list as Move[]
    },
    replays: () => replay(r, steps, players) === JSON.stringify(state),
  }
  return game
}

/**
 * Plays many random games from moves() (now and then letting the clock run out, or leaving) and reports what
 * broke: rules that throw, moves() listing a move that move() refuses, a turn with nothing to play, games that
 * never end, and games that don't replay the same. An empty `problems` is a pass.
 */
export function fuzz<State, Move, View>(rules: Rules<State, Move, View>, opts: FuzzOptions = {}): FuzzReport {
  return fuzzRules(rulesOf(rules, []).rules, opts)
}
