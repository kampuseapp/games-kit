// XOX's rules: Kampuse runs these to judge every move, so a changed screen cannot cheat.
import { defineRules, refuse } from '@kampuse/games-kit/rules'

/** A square: side 0's X, side 1's O, or empty. */
type Mark = 0 | 1 | null

export type State = {
  cells: Mark[]
  /** Whose move it is. */
  next: 0 | 1
  /** The three squares that won, once someone has. */
  line: number[] | null
  /** Who won ([] for a draw), once the game is over. */
  winners: number[] | null
}

/** What a screen sends: the square to mark, 0 to 8, row by row. */
export type Move = { cell: number }

/** What everyone sees: there is nothing hidden in XOX, so the board and the winning line. */
export type View = { cells: Mark[]; line: number[] | null }

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
]

function mark(state: State, side: 0 | 1, cell: number): State {
  state.cells[cell] = side
  const line = LINES.find((l) => l.every((i) => state.cells[i] === side))
  if (line) {
    state.line = line
    state.winners = [side]
  } else if (state.cells.every((c) => c !== null)) state.winners = []
  else state.next = side === 0 ? 1 : 0
  return state
}

export default defineRules<State, Move, View>({
  // Who starts is drawn with ctx.random, so a replay draws the same.
  setup: (ctx) => ({ cells: Array<Mark>(9).fill(null), next: ctx.random() < 0.5 ? 0 : 1, line: null, winners: null }),

  turn: (state) => (state.winners ? [] : [state.next]),

  move(state, side, move) {
    // A move comes from a player's phone: check everything about it.
    const cell = typeof move === 'object' && move !== null ? move.cell : undefined
    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) return refuse('Pick a square.')
    if (state.cells[cell] !== null) return refuse('That square is taken.')
    return mark(state, side as 0 | 1, cell)
  },

  // Every free square: lets the simulator seat bots and fuzz the rules.
  moves: (state) => (state.winners ? [] : state.cells.flatMap((c, i) => (c === null ? [{ cell: i }] : []))),

  view: (state) => ({ cells: state.cells, line: state.line }),

  result: (state) => (state.winners ? { winners: state.winners } : null),

  // Out of time: a free square is marked for them.
  timeout(state, side, ctx) {
    const free = state.cells.flatMap((c, i) => (c === null ? [i] : []))
    return mark(state, side as 0 | 1, free[Math.floor(ctx.random() * free.length)])
  },

  // Leaving gives the game to the other side.
  leave(state, side) {
    state.winners = [side === 0 ? 1 : 0]
    return state
  },
})
