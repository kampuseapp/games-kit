// XOX's rules, tested without a browser: `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuzz, startGame } from '@kampuse/games-kit/testing'
import rules from './rules'

/** A fresh game, and its two sides in playing order. */
function fresh(seed = 7) {
  const game = startGame(rules, { players: 2, seed })
  const first = game.turn[0]
  return { game, first, second: 1 - first }
}

test('three in a row wins', () => {
  const { game, first, second } = fresh()
  const plays: [number, number][] = [[first, 0], [second, 3], [first, 1], [second, 4], [first, 2]]
  for (const [side, cell] of plays) assert.deepEqual(game.move(side, { cell }), { ok: true })
  assert.deepEqual(game.over, { winners: [first] })
  assert.deepEqual(game.turn, [])
  assert.deepEqual(game.view(second).line, [0, 1, 2])
  assert.ok(game.replays())
})

test('a full board with no line is a draw', () => {
  const { game, first, second } = fresh()
  // X O X / X O O / O X X
  const plays: [number, number][] = [[first, 0], [second, 1], [first, 2], [second, 4], [first, 3], [second, 5], [first, 7], [second, 6], [first, 8]]
  for (const [side, cell] of plays) game.move(side, { cell })
  assert.deepEqual(game.over, { winners: [] })
})

test('bad moves are refused, and nothing changes', () => {
  const { game, first, second } = fresh()
  game.move(first, { cell: 4 })
  assert.deepEqual(game.move(second, { cell: 4 }), { refused: 'That square is taken.' })
  assert.deepEqual(game.move(second, { cell: 9 }), { refused: 'Pick a square.' })
  assert.deepEqual(game.move(second, 'four' as never), { refused: 'Pick a square.' })
  assert.deepEqual(game.move(first, { cell: 0 }), { refused: 'Not your turn.' })
  assert.equal(game.steps.length, 2)
})

test('running out of time plays a free square', () => {
  const { game, first } = fresh()
  game.timeout(first)
  assert.equal(game.view(null).cells.filter((c) => c !== null).length, 1)
  assert.ok(!game.turn.includes(first))
})

test('leaving gives the game to the other side', () => {
  const { game, first, second } = fresh()
  game.leave(first)
  assert.deepEqual(game.over, { winners: [second] })
})

test('no warnings from the checks', () => {
  const { game, first, second } = fresh()
  game.move(first, { cell: 0 })
  game.move(second, { cell: 8 })
  assert.deepEqual(game.notes, [])
})

test('500 random games all end, with no problems', () => {
  const report = fuzz(rules, { games: 500, players: 2 })
  assert.deepEqual(report.problems, [])
  assert.equal(report.ended, 500)
})
