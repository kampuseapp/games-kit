// Running a game's rules the way Kampuse does, with its checks: every call timed, the state and the views
// plain JSON within the limits, and no Math.random or Date.now (a game must replay the same from its steps).
// The simulator's worker, the testing kit (testing.ts) and Kampuse itself all judge through this one file,
// so a game that passes here passes there.

import { LIMITS, jsonBytes, type Result } from './protocol'
import { isRefusal, type Ctx, type Rules } from './rules'

/** A rules module, whatever its types. */
export type AnyRules = Rules<unknown, unknown, unknown>

/** Something the checks noticed. A warning lets the game go on; an error is thrown as a RulesError. */
export type Note = { level: 'warn' | 'error'; text: string }

/** A problem with the rules themselves (not a refused move): the step goes no further. */
export class RulesError extends Error {}

/** One thing that happened to a game, as the rules were asked it. A game's steps replay it exactly. */
export type Step =
  | { op: 'start'; seed: number; now: number }
  | { op: 'move'; side: number; move: unknown; seed: number; now: number }
  | { op: 'timeout' | 'leave'; side: number; seed: number; now: number }

/** What everyone sees after a step: views[side] for each side, and `watcher` for anyone watching. */
export type Shown = { turn: number[]; over: Result | null; views: unknown[]; watcher: unknown }

/** Which of the optional functions the rules have. */
export type Has = { moves: boolean; timeout: boolean; leave: boolean }

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** A small seeded random generator (mulberry32): the same seed, the same numbers. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A step's seed, from the game's seed and how many steps came before. */
export const stepSeed = (seed: number, n: number): number => {
  let h = (seed ^ Math.imul(n + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

export const ctxFor = (players: number, seed: number, now: number): Ctx => ({ players, random: seeded(seed), now })

/** Checks a module's export is a game's rules, and says which optional parts it has. */
export function rulesOf(mod: unknown, notes: Note[]): { rules: AnyRules; has: Has } {
  const m = mod as { default?: AnyRules; rules?: AnyRules } | null
  const r = m && typeof m === 'object' && 'setup' in m ? (m as unknown as AnyRules) : (m?.default ?? m?.rules)
  if (!r || typeof r !== 'object') throw new RulesError('rules.ts must `export default defineRules({ … })`.')
  const missing = (['setup', 'turn', 'move', 'view', 'result'] as const).filter((k) => typeof r[k] !== 'function')
  if (missing.length) throw new RulesError(`The rules are missing ${missing.join(', ')}.`)
  const has: Has = { moves: typeof r.moves === 'function', timeout: typeof r.timeout === 'function', leave: typeof r.leave === 'function' }
  if (!has.moves) notes.push({ level: 'warn', text: 'The rules have no moves(): no bots, no fuzzing, and running out of time can only be handled by timeout().' })
  if (!has.timeout && !has.moves) notes.push({ level: 'warn', text: 'The rules have no timeout() and no moves(): running out of time will count as leaving.' })
  if (!has.leave) notes.push({ level: 'warn', text: 'The rules have no leave(): when anyone leaves, the game ends and everyone still in wins.' })
  return { rules: r, has }
}

const realRandom = Math.random
const realNow = Date.now
const clock = () => performance.now()

/** Runs one function of the rules: timed, with Math.random and Date.now watched (they still work, from ctx). */
function call<T>(name: string, ctx: Ctx | null, notes: Note[], fn: () => T): T {
  const used = new Set<'Math.random' | 'Date.now'>()
  Math.random = () => {
    used.add('Math.random')
    return ctx ? ctx.random() : realRandom()
  }
  Date.now = () => {
    used.add('Date.now')
    return ctx ? ctx.now : realNow()
  }
  const began = clock()
  try {
    return fn()
  } catch (e) {
    if (e instanceof RulesError) throw e
    throw new RulesError(`rules.${name} threw: ${describe(e)}`)
  } finally {
    Math.random = realRandom
    Date.now = realNow
    const ms = clock() - began
    if (ms > LIMITS.rulesMs) notes.push({ level: 'warn', text: `rules.${name} took ${Math.round(ms)} ms. Keep each call under ${LIMITS.rulesMs} ms.` })
    for (const what of used)
      notes.push({ level: 'warn', text: `rules.${name} used ${what}. Use ${what === 'Math.random' ? 'ctx.random()' : 'ctx.now'} instead, so the game replays the same from its steps.` })
  }
}

/** The first thing in a value that is not plain JSON, as a path and what it is; null when it all is. */
export function notPlain(value: unknown, path: string, depth = 0): string | null {
  if (depth > 64) return `${path} is nested more than 64 deep`
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : `${path} is ${value} (JSON has no NaN or Infinity)`
  if (value === undefined) return `${path} is undefined (use null)`
  if (typeof value !== 'object') return `${path} is a ${typeof value}`
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return `${path}[${i}] is an empty slot`
      const found = notPlain(value[i], `${path}[${i}]`, depth + 1)
      if (found) return found
    }
    return null
  }
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return `${path} is a ${proto?.constructor?.name ?? 'class instance'} (use plain objects and arrays)`
  for (const [key, inner] of Object.entries(value)) {
    const found = notPlain(inner, `${path}.${key}`, depth + 1)
    if (found) return found
  }
  return null
}

function checkState(state: unknown, name: string): void {
  if (state === undefined) throw new RulesError(`rules.${name} returned nothing. Return the new state${name === 'move' ? ', or refuse(reason)' : ''}.`)
  const problem = notPlain(state, 'state')
  if (problem) throw new RulesError(`rules.${name} returned a state that is not plain JSON: ${problem}.`)
  const bytes = jsonBytes(state)
  if (bytes > LIMITS.stateBytes) throw new RulesError(`The state is ${bytes} bytes after rules.${name}. The limit is ${LIMITS.stateBytes}.`)
}

const isSides = (value: unknown, players: number): value is number[] =>
  Array.isArray(value) && value.every((s) => Number.isInteger(s) && s >= 0 && s < players)

/** Whose turn it is and how it ended (no views): what the testing kit and fuzzing need at every step. */
export function status(r: AnyRules, state: unknown, players: number, notes: Note[]): { turn: number[]; over: Result | null } {
  const turn = call('turn', null, notes, () => r.turn(structuredClone(state)))
  if (!isSides(turn, players)) throw new RulesError(`rules.turn must return an array of sides (0 to ${players - 1}); it returned ${JSON.stringify(turn)}.`)
  const over = call('result', null, notes, () => r.result(structuredClone(state)))
  if (over !== null && !(over && typeof over === 'object' && isSides((over as Result).winners, players)))
    throw new RulesError(`rules.result must return null or { winners: [sides] }; it returned ${JSON.stringify(over)}.`)
  if (over && turn.length) notes.push({ level: 'warn', text: 'rules.result says the game is over, but rules.turn still lists sides. Return [] from turn once it is over.' })
  return { turn: [...turn], over: over ? { winners: [...over.winners] } : null }
}

/** One side's view (null: a watcher), checked. */
export function viewOf(r: AnyRules, state: unknown, side: number | null, notes: Note[]): unknown {
  const view = call('view', null, notes, () => r.view(structuredClone(state), side))
  const who = side === null ? 'the watcher' : `side ${side}`
  const problem = notPlain(view, 'view')
  if (problem) throw new RulesError(`rules.view for ${who} is not plain JSON: ${problem}.`)
  const bytes = jsonBytes(view)
  if (bytes > LIMITS.viewBytes) notes.push({ level: 'warn', text: `The view for ${who} is ${bytes} bytes. Keep views under ${LIMITS.viewBytes}.` })
  return view
}

/** Whose turn it is, how it ended, and every view, after a step. */
export function show(r: AnyRules, state: unknown, players: number, notes: Note[]): Shown {
  const { turn, over } = status(r, state, players, notes)
  return { turn, over, views: Array.from({ length: players }, (_, side) => viewOf(r, state, side, notes)), watcher: viewOf(r, state, null, notes) }
}

/** The moves a side could make (rules.moves), checked; null when the rules have no moves(). */
export function legalMoves(r: AnyRules, state: unknown, side: number, notes: Note[]): unknown[] | null {
  const fn = r.moves
  if (!fn) return null
  const list = call('moves', null, notes, () => fn(structuredClone(state), side))
  if (!Array.isArray(list)) throw new RulesError(`rules.moves must return an array of moves; it returned ${JSON.stringify(list)}.`)
  const problem = notPlain(list, 'moves')
  if (problem) throw new RulesError(`rules.moves is not plain JSON: ${problem}.`)
  return list
}

/** Plays one step on a state: the new state, or the reason a move was turned down. */
export function play(r: AnyRules, step: Step, state: unknown, players: number, notes: Note[]): { state: unknown } | { refused: string } {
  const ctx = ctxFor(players, step.seed, step.now)
  let next: unknown
  switch (step.op) {
    case 'start':
      next = call('setup', ctx, notes, () => r.setup(ctx))
      break
    case 'move': {
      const out = call('move', ctx, notes, () => r.move(structuredClone(state), step.side, structuredClone(step.move), ctx))
      if (isRefusal(out)) return { refused: out.refused }
      next = out
      break
    }
    case 'timeout': {
      const timeout = r.timeout
      if (timeout) {
        next = call('timeout', ctx, notes, () => timeout(structuredClone(state), step.side, ctx))
        break
      }
      // No timeout(): one of moves() at random, from the step's own ctx, so a replay picks the same.
      const list = legalMoves(r, state, step.side, notes)
      if (!list) throw new RulesError('The rules have no timeout() and no moves().')
      if (!list.length) throw new RulesError(`The clock ran out for side ${step.side}, but rules.moves lists nothing for them.`)
      const move = list[Math.floor(ctx.random() * list.length)]
      const out = call('move', ctx, notes, () => r.move(structuredClone(state), step.side, structuredClone(move), ctx))
      if (isRefusal(out)) throw new RulesError(`rules.moves listed ${JSON.stringify(move)}, but rules.move turned it down: ${out.refused}`)
      next = out
      break
    }
    case 'leave': {
      const leave = r.leave
      if (!leave) throw new RulesError('The rules have no leave().')
      next = call('leave', ctx, notes, () => leave(structuredClone(state), step.side, ctx))
      break
    }
  }
  if (isRefusal(next)) throw new RulesError(`rules.${step.op === 'start' ? 'setup' : step.op} cannot refuse: return the state.`)
  checkState(next, step.op === 'start' ? 'setup' : step.op)
  return { state: next }
}

/** A game played again from its steps: the state it ends in, as JSON. */
export function replay(r: AnyRules, steps: Step[], players: number): string {
  let state: unknown = null
  for (const step of steps) {
    const out = play(r, step, state, players, [])
    if ('refused' in out) throw new RulesError(`On replay, a move the game took was turned down: ${out.refused}`)
    state = out.state
  }
  return JSON.stringify(state)
}

// ---------- Kampuse's own part of a table, the same everywhere ----------

/** Why Kampuse turns a move down before the rules see it, or null when it goes to them. */
export function hostRefusal(t: { turn: number[]; over: Result | null; in: boolean[] }, side: number): string | null {
  if (!t.in[side]) return 'You have left this game.'
  if (t.over) return 'The game is over.'
  if (!t.turn.includes(side)) return 'Not your turn.'
  return null
}

/** The end of a game whose rules have no leave(): everyone still in wins. */
export const endWithoutLeave = (seatsIn: boolean[]): Result => ({ winners: seatsIn.flatMap((on, side) => (on ? [side] : [])) })

// ---------- fuzzing ----------

export type FuzzOptions = {
  /** How many games to play (default 200). */
  games?: number
  /** Players per game (default 2). */
  players?: number
  /** Steps a game may take before it counts as one that never ends (default 2,000). */
  maxSteps?: number
  /** The seed for the whole run: the same seed, the same games (default 1). */
  seed?: number
  /** Share of steps where the side lets the clock run out instead of moving (default 0.03). */
  timeouts?: number
  /** Share of steps where the side leaves the table instead (default 0.01). */
  leaves?: number
}

export type FuzzReport = {
  games: number
  /** Games that ended (rules.result said so). */
  ended: number
  steps: number
  /** How many games each side won, by side. */
  wins: number[]
  draws: number
  /** The problems found, each once, with the game and step it first showed up in (and a move that shows it). */
  problems: { text: string; game: number; step: number; times: number; example?: string }[]
  ms: number
}

/**
 * Plays many random games, picking from rules.moves at every turn (and now and then letting the clock run out,
 * or leaving), to find what breaks: rules that throw, moves() listing a move that move() refuses, a turn with no
 * moves, games that never end, and games that do not replay the same.
 */
export function fuzz(r: AnyRules, opts: FuzzOptions = {}): FuzzReport {
  const games = opts.games ?? 200
  const players = opts.players ?? 2
  const maxSteps = opts.maxSteps ?? 2_000
  const timeouts = opts.timeouts ?? 0.03
  const leaves = opts.leaves ?? 0.01
  const pick = seeded(opts.seed ?? 1)
  const began = clock()
  const report: FuzzReport = { games, ended: 0, steps: 0, wins: Array.from({ length: players }, () => 0), draws: 0, problems: [], ms: 0 }
  const problem = (text: string, game: number, step: number, example?: unknown) => {
    const seen = report.problems.find((p) => p.text === text)
    if (seen) seen.times++
    else if (report.problems.length < 50)
      report.problems.push({ text, game, step, times: 1, ...(example === undefined ? {} : { example: JSON.stringify(example).slice(0, 200) }) })
  }
  if (!r.moves) {
    problem('The rules have no moves(), so they cannot be fuzzed.', 0, 0)
    return { ...report, games: 0 }
  }
  for (let g = 0; g < games; g++) {
    const seed = Math.floor(pick() * 2 ** 32)
    const steps: Step[] = []
    const seatsIn = Array.from({ length: players }, () => true)
    let state: unknown = null
    let over: Result | null = null
    /** A problem stopped this game early (it is reported once, not again as "never ended"). */
    let stopped = false
    const stop = (text: string, n: number, example?: unknown) => {
      problem(text, g, n, example)
      stopped = true
    }
    /** What the checks noticed in this game, step by step: each becomes a problem. */
    const notes: Note[] = []
    const noted = (n: number) => {
      for (const note of notes.splice(0)) problem(note.text, g, n)
    }
    /** Every side's view and the watcher's, as Kampuse asks for them after each step. */
    const look = (n: number) => {
      for (let side = 0; side < players; side++) viewOf(r, state, side, notes)
      viewOf(r, state, null, notes)
      noted(n)
    }
    try {
      const first: Step = { op: 'start', seed: stepSeed(seed, 0), now: 0 }
      state = (play(r, first, null, players, notes) as { state: unknown }).state
      steps.push(first)
      look(0)
      for (let n = 1; n <= maxSteps; n++) {
        const s = status(r, state, players, notes)
        over = s.over
        if (over) break
        if (!s.turn.length) {
          stop('rules.turn is empty, but rules.result says the game is not over: nobody can move.', n)
          break
        }
        const side = s.turn[Math.floor(pick() * s.turn.length)]
        if (!seatsIn[side]) {
          stop(`rules.turn lists side ${side}, who has left. Skip them in leave().`, n)
          break
        }
        const roll = pick()
        let step: Step
        if (roll < leaves && seatsIn.filter(Boolean).length > 1) {
          seatsIn[side] = false
          if (!r.leave) {
            over = endWithoutLeave(seatsIn)
            break
          }
          step = { op: 'leave', side, seed: stepSeed(seed, n), now: n * 1000 }
        } else if (roll < leaves + timeouts) {
          step = { op: 'timeout', side, seed: stepSeed(seed, n), now: n * 1000 }
        } else {
          const list = legalMoves(r, state, side, notes)!
          if (!list.length) {
            stop(`It is side ${side}'s turn, but rules.moves lists nothing for them.`, n)
            break
          }
          const move = list[Math.floor(pick() * list.length)]
          step = { op: 'move', side, move, seed: stepSeed(seed, n), now: n * 1000 }
        }
        const out = play(r, step, state, players, notes)
        if ('refused' in out) {
          stop(`rules.moves listed a move that rules.move turned down: ${out.refused}`, n, (step as { move: unknown }).move)
          break
        }
        state = out.state
        steps.push(step)
        report.steps++
        look(n)
      }
      // The last step may have ended it.
      if (!over && !stopped) over = status(r, state, players, []).over
      if (over) {
        report.ended++
        if (over.winners.length) for (const w of over.winners) report.wins[w]++
        else report.draws++
      } else if (!stopped) problem(`A game went ${maxSteps} steps without ending.`, g, steps.length)
      // Every game must replay the same from its steps.
      if (replay(r, steps, players) !== JSON.stringify(state))
        problem('A game played again from its steps ended differently: the rules depend on something besides the state and ctx.', g, steps.length)
    } catch (e) {
      problem(describe(e), g, steps.length)
    }
  }
  report.ms = Math.round(clock() - began)
  return report
}
