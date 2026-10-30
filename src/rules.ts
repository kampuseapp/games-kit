// The rules of a table game: what Kampuse runs on its side to judge every move, so nobody can cheat by
// changing their own screen. They are plain functions over plain data. Kampuse keeps the state between
// calls and gives each call its own copy, so a function may change the state it is given and return it.
//
// Kampuse runs them in a sealed space: no network, no storage, no timers, no DOM. Keep them small and
// quick (LIMITS.rulesMs a call), and use ctx.random and ctx.now, never Math.random or Date.now, so a
// game can be replayed move by move and come out the same.

import type { Result } from './protocol'

export type { Result }

/** What every call to the rules is given. */
export type Ctx = {
  /** How many sit at the table, from the start: sides 0 to players - 1. */
  players: number
  /** A random number from 0 (included) to 1 (not included), the same on every replay. */
  random: () => number
  /** Kampuse's clock (ms). */
  now: number
}

/** A move turned down, with a short reason the player is shown. */
export type Refusal = { readonly refused: string }

/** Turns a move down: `return refuse('That square is taken.')`. */
export const refuse = (reason: string): Refusal => ({ refused: reason })

/** Whether a rules call turned the move down. */
export const isRefusal = (value: unknown): value is Refusal =>
  !!value && typeof value === 'object' && Object.keys(value).length === 1 && typeof (value as Refusal).refused === 'string'

/**
 * A table game's rules. State is anything JSON (objects, arrays, strings, numbers, booleans, null)
 * up to LIMITS.stateBytes; Move is what the screen sends (check it: it comes from a player's phone);
 * View is what one player is shown.
 */
export type Rules<State, Move = unknown, View = unknown> = {
  /** The game as it starts. */
  setup(ctx: Ctx): State
  /**
   * Whose move it is: the sides that may move now (usually one). Empty once the game is over.
   * Kampuse passes on a move only from a side listed here, and runs the turn clock for them.
   */
  turn(state: State): number[]
  /** A move from a side whose turn it is: the state after it, or refuse(reason). */
  move(state: State, side: number, move: Move, ctx: Ctx): State | Refusal
  /** What a side is shown (null: someone watching). Leave out anything they may not see, such as other hands. */
  view(state: State, side: number | null): View
  /** How the game ended, or null while it goes on. */
  result(state: State): Result | null
  /**
   * Every move a side could make now (optional, but worth it). With it, the simulator can seat bots and play
   * hundreds of random games to find bugs (Fuzz), tests can do the same (fuzz() in the testing kit), and when the
   * clock runs out and there is no timeout(), Kampuse plays one of these at random. Keep the order the same for
   * the same state: a replay picks by position.
   */
  moves?(state: State, side: number): Move[]
  /**
   * The turn's clock ran out for a side: what happens instead (play a move for them, or pass). Without it, a
   * random move from moves() is played; without either, running out of time counts as leaving.
   */
  timeout?(state: State, side: number, ctx: Ctx): State
  /**
   * A side left (or was away LIMITS.idleTurns turns in a row): the game without them. Without it,
   * the game ends there, and everyone still in wins.
   */
  leave?(state: State, side: number, ctx: Ctx): State
}

/** Declares a game's rules, with their types checked: `export default defineRules({ … })`. */
export const defineRules = <State, Move = unknown, View = unknown>(rules: Rules<State, Move, View>): Rules<State, Move, View> => rules
