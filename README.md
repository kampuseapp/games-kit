# Kampuse Games Kit

Make games for [Kampuse](https://kampuse.com): the functions a game calls, and a simulator that plays it the way Kampuse will.
You never need Kampuse's own code.

## Start

Needs [Node.js](https://nodejs.org) 20.19+ (22.12+ on the 22 line).

```sh
git clone https://github.com/kampuseapp/games-kit && cd games-kit && npm install
npm run new -- my-game                # table game, from examples/xox
npm run new -- my-game --solo         # solo game, from examples/ari
npm run dev                           # simulator at http://127.0.0.1:5390
npm test                              # every rules.test.ts
npm run check-game -- games/my-game   # the checks a game must pass
```

## Two kinds of game

| | Table | Solo |
|---|---|---|
| Players | 2 to 4, with a turn clock | 1 |
| Files | `game.json`, `index.html`, `rules.ts` | `game.json`, `index.html` |
| Decides what happens | Your rules, run by Kampuse | Your screen |
| Ends with | `rules.result()` | `score(n, true)` |

The screen draws and sends moves; the rules judge them. Changing your own screen can't cheat.

## game.json

```json
{
  "id": "my-game",
  "name": "My Game",
  "emoji": "🎲",
  "kind": "table",
  "players": { "min": 2, "max": 4 },
  "turnSeconds": 30,
  "about": "One line on what it is."
}
```

`id`: 2 to 24 lowercase letters, digits or dashes, fixed once in Kampuse. `kind`: `table` or `solo`. `turnSeconds`: 5 to 300.

## The screen

`index.html` is a web page in a phone-sized frame: portrait, about 360×640 and up, any framework or none.

```ts
import { connect } from '@kampuse/games-kit'

const kampuse = await connect<MyView>('my-game')   // the id from game.json

kampuse.me          // { side, username, name, avatar, in }; side -1 is a watcher
kampuse.players     // everyone at the table, by side
kampuse.lang        // 'tr' or 'en': write your text in both
kampuse.watching    // true for a watcher

kampuse.on('view', (turn) => draw(turn))           // every change, and at once
kampuse.on('refused', (reason) => toast(reason))
kampuse.on('players', (players) => …)              // someone left
kampuse.on('pause', () => …)                       // put away: stop sounds
kampuse.on('resume', () => …)

kampuse.move({ cell: 4 })   // table: a move for the rules to judge
kampuse.leave()             // leaving a table counts as losing
kampuse.score(120)          // solo: the score so far
kampuse.score(120, true)    // solo: the round is over
```

A view is `{ view, turn, ends, seq, over }`: what your rules show, the sides to move, when the clock ends on this device (ms) or
`null`, a counter, and `{ winners: [sides] }` (`[]` is a draw) or `null`.

Decide nothing on the screen. Don't rely on browser storage or cookies.

## The rules (table games)

```ts
import { defineRules, refuse } from '@kampuse/games-kit/rules'

export default defineRules<State, Move, View>({
  setup: (ctx) => …,                  // the game as it starts
  turn: (state) => [state.next],      // whose move it is; [] once it's over
  move(state, side, move, ctx) {
    if (!valid(move)) return refuse('Pick a square.')
    return state                      // the state after it
  },
  view: (state, side) => …,           // what a side sees (null: a watcher)
  result: (state) => …,               // { winners: [sides] }, or null while it goes on
  moves: (state, side) => […],        // optional: gives bots, fuzzing and a fair timeout
  timeout: (state, side, ctx) => …,   // optional: the clock ran out
  leave: (state, side, ctx) => …,     // optional: the game without someone who left
})
```

- **Plain JSON state.** No classes, `Date`, `Map`, `undefined` or functions.
- **`ctx.random()` and `ctx.now` only,** never `Math.random()` or `Date.now()`. Games are replayed to check results.
- **Nothing outside the state.** You may change the state you're given and return it.
- **Check every move.** Refuse with a short English reason.
- **Show only what a player may see.**
- **Well under 50 ms a call.** No network, storage or timers. Keep `moves()` in a stable order.

Kampuse handles seats, invites, the clock, watchers and chat. Only a side whose turn it is reaches `move()`.

- **Clock runs out:** `timeout()`, else a random `moves()`, else it counts as leaving. So do three timeouts in a row.
- **Someone leaves:** `leave()`, else the game ends and everyone still in wins.

## Testing

```ts
import { fuzz, startGame } from '@kampuse/games-kit/testing'

const game = startGame(rules, { players: 2, seed: 7 })     // acts like a Kampuse table
game.move(game.turn[0], { cell: 0 })                       // { ok: true } or { refused: 'reason' }
assert.ok(game.replays())
assert.deepEqual(fuzz(rules, { games: 500, players: 2 }).problems, [])   // needs moves()
```

Full example: `examples/xox/rules.test.ts`.

## Limits

Move 4 KB, view 16 KB, state 64 KB of JSON. 50 ms a rules call. 10 moves a second per player.

## The simulator

Lists every folder in `games/` and `examples/` with a `game.json`, and keeps your place when you save. Under each screen: 🤖 Bot,
⏸ Pause, ↻ Reload, 🚪 Leave. 🎲 Fuzz plays 200 games, and **Game state** shows every player's view side by side. The log flags
broken rules, and a ✗ at the end of a game means it didn't replay the same.

## Bring your game

Pass `check-game`, then open a pull request to **[kampuseapp/games](https://github.com/kampuseapp/games)**. Merged is approved.

## Without the kit's code

The messages are in `src/protocol.ts`, each with `kampuse: 1`.

## Contributing

Issues and pull requests welcome; games go to [kampuseapp/games](https://github.com/kampuseapp/games). Report security problems
privately: Security tab → Report a vulnerability.

## License

MIT, see [LICENSE](LICENSE). It covers this kit, not the games you make with it.
