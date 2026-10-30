// The messages between Kampuse and a game's screen. The screen is a web page of its own, shown in a
// frame inside Kampuse (or the simulator); the two talk only through window.postMessage, and only in
// the shapes below. src/screen.ts wraps them for the game, so most games never touch them directly.

/** The kit's version: every message carries it, and one from another version is ignored. */
export const KIT_VERSION = 1

/** What a message must fit in, and how fast a player may move (the simulator warns past them). */
export const LIMITS = {
  /** A move sent by a screen, as JSON. */
  moveBytes: 4_096,
  /** A view sent to one player, as JSON. */
  viewBytes: 16_384,
  /** The whole game state the rules keep, as JSON. */
  stateBytes: 65_536,
  /** One call to the rules (setup, move, view, …). */
  rulesMs: 50,
  /** Moves a player may send in a second; more are refused. */
  movesPerSecond: 10,
  /** Turns in a row a player may leave to the clock before they count as gone. */
  idleTurns: 3,
} as const

/** A game played at a table, turn by turn, under rules Kampuse runs; or one played alone for a score. */
export type GameKind = 'table' | 'solo'

/** A student in the game, as the game is told about them. Nothing else about anyone is shared. */
export type Player = {
  /** Their place in playing order: 0, 1, 2, 3. -1 for someone watching. */
  side: number
  username: string
  /** Their name as Kampuse shows it. */
  name: string
  /** A picture of their avatar's face (an image URL, square). */
  avatar: string
  /** Still in the game: false once they left, or were away for LIMITS.idleTurns turns in a row. */
  in: boolean
}

/** How a game ended: the sides that won. Empty for a draw. */
export type Result = { winners: number[] }

/** The game as one player sees it, with whose turn it is. */
export type Turn<View = unknown> = {
  /** What the rules show this player (Rules.view): never more than they may see. */
  view: View
  /** Whose move it is (sides). Empty when nobody's: the game is over. */
  turn: number[]
  /** When the turn's clock runs out, on this device's clock (ms); null when there is no clock. */
  ends: number | null
  /** Goes up with every change, so an older view arriving late can be told apart. */
  seq: number
  /** How it ended, once it has. */
  over: Result | null
}

/** What the screen is told first, and again whenever it says hello. */
export type Welcome = {
  game: string
  kind: GameKind
  /** You. Watching, your side is -1. */
  me: Player
  /** Everyone playing, by side. */
  players: Player[]
  /** The language the student plays Kampuse in. */
  lang: 'tr' | 'en'
  watching: boolean
}

/** From Kampuse to the screen. */
export type HostMsg =
  | ({ t: 'welcome' } & Welcome)
  | ({ t: 'view'; /** Kampuse's clock when it was sent (ms), to turn `ends` into the device's. */ now: number } & Turn)
  /** A move the rules turned down, and why (a short sentence the screen can show). */
  | { t: 'refused'; reason: string }
  /** Someone left, or came back. */
  | { t: 'players'; players: Player[] }
  /** The student put the game away for a moment (closed the phone app, switched away), and came back. */
  | { t: 'pause' }
  | { t: 'resume' }

/** From the screen to Kampuse. */
export type ScreenMsg =
  /** Sent until Kampuse answers with a welcome, and again after a reload. */
  | { t: 'hello'; game: string }
  /** A move for the rules to judge (table games). Anything JSON, up to LIMITS.moveBytes. */
  | { t: 'move'; move: unknown }
  /** Leaving the game: at a table, it counts as losing. */
  | { t: 'leave' }
  /** A score (solo games): the best of a round so far, and whether the round is over. */
  | { t: 'score'; score: number; final: boolean }

/** Every message, as it goes over postMessage. */
export type Envelope<M> = M & { kampuse: typeof KIT_VERSION }

const HOST_TYPES = new Set(['welcome', 'view', 'refused', 'players', 'pause', 'resume'])
const SCREEN_TYPES = new Set(['hello', 'move', 'leave', 'score'])

const isEnvelope = (data: unknown): data is { kampuse: number; t: string } =>
  !!data && typeof data === 'object' && (data as { kampuse?: unknown }).kampuse === KIT_VERSION && typeof (data as { t?: unknown }).t === 'string'

/** Whether a message is one of Kampuse's (checked by the screen; the sender is checked too, see screen.ts). */
export const isHostMsg = (data: unknown): data is Envelope<HostMsg> => isEnvelope(data) && HOST_TYPES.has(data.t)

/** Whether a message is one of a screen's (checked by Kampuse, which also checks which frame sent it). */
export const isScreenMsg = (data: unknown): data is Envelope<ScreenMsg> => isEnvelope(data) && SCREEN_TYPES.has(data.t)

/** A message ready to post. */
export const envelope = <M extends HostMsg | ScreenMsg>(msg: M): Envelope<M> => ({ ...msg, kampuse: KIT_VERSION })

/** Bytes a value takes as JSON (what the limits count). */
export const jsonBytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? '').length
