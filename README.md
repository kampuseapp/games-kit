# Kampuse Games Kit

Make a game that students play inside Kampuse: at a table on campus with friends, or alone for a score.
This kit is everything you need: the few functions your game calls, and a **simulator** that plays your
game the way Kampuse will, with up to four pretend students, a watcher and a turn clock.

You never need Kampuse's own code. Your game talks to Kampuse only through the messages in this kit.

## Two kinds of game

| | **Table game** (`"kind": "table"`) | **Solo game** (`"kind": "solo"`) |
|---|---|---|
| Players | 2 to 4, at a table | 1 |
| Files | `game.json`, `index.html` (the screen), `rules.ts` | `game.json`, `index.html` |
| Who decides what happens | Your **rules**, which Kampuse runs on its side | Your screen |
| Turns | One player (or more) at a time, with a clock | – |
| Ends with | `rules.result()` saying who won | `score(n, true)` |

A table game is split in two on purpose. The **screen** draws the game and sends taps as moves. The
**rules** judge every move and say what each player sees. A student who changes their own screen still
can't cheat, because Kampuse only believes the rules.

## Start

You need [Node.js](https://nodejs.org) 20.19 or newer (22.12+ on the 22 line).

```sh
git clone https://github.com/kampuseapp/games-kit
cd games-kit
npm install
npm run new -- my-game          # a table game in games/my-game, from the XOX example
npm run new -- my-game --solo   # …or a solo game, from Arı Avı
npm run dev                     # the simulator: open http://127.0.0.1:5390
npm test                        # your rules' tests (rules.test.ts)
```

The examples:

- `examples/xox`: XOX (tic-tac-toe), a two-player table game, with tests.
- `examples/ari`: Arı Avı, a solo game (tap the bees).

The simulator lists every folder in `games/` and `examples/` with a `game.json`. Save a file and it
updates without losing your place: a screen's code reloads just the screens and the game goes on, CSS
updates in place, and a changed `rules.ts` starts a new game with the new rules.

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

- `id`: 2 to 24 lowercase letters, digits or dashes. It never changes once the game is in Kampuse.
- `turnSeconds`: 5 to 300. Each turn's clock (table games).

## The screen

`index.html` is an ordinary web page. Use any framework or none. It runs in a frame of its own inside
Kampuse, the size of a phone screen (about 360×640 and up; design for portrait).

```ts
import { connect } from '@kampuse/games-kit'

const kampuse = await connect<MyView>('my-game')   // the id from game.json

kampuse.me          // you: { side, username, name, avatar, in }. side is -1 when watching.
kampuse.players     // everyone at the table, by side
kampuse.lang        // 'tr' or 'en': write your text in both
kampuse.watching    // true for someone watching, who can't move

kampuse.on('view', (turn) => draw(turn))   // after every change, and at once when you start listening
kampuse.on('refused', (reason) => toast(reason))
kampuse.on('players', (players) => …)      // someone left
kampuse.on('pause', () => …)               // the student put the game away for a moment: stop sounds
kampuse.on('resume', () => …)

kampuse.move({ cell: 4 })   // table games: a move for the rules to judge
kampuse.leave()             // leaving a table counts as losing
kampuse.score(120)          // solo games: the score so far
kampuse.score(120, true)    // …and when the round is over
```

A view arrives as `{ view, turn, ends, seq, over }`:

- `view`: what your rules show this player.
- `turn`: whose move it is (sides). Empty once the game is over.
- `ends`: when the turn's clock runs out, on this device's clock (ms), or `null`.
- `seq`: goes up with every change.
- `over`: `{ winners: [sides] }` once it's over (`[]` is a draw), else `null`.

Don't decide anything on the screen: send the move and draw the next view. Don't count on browser
storage or cookies either; ask us if your game needs to remember something.

## The rules (table games)

`rules.ts` exports plain functions over plain data:

```ts
import { defineRules, refuse } from '@kampuse/games-kit/rules'

export default defineRules<State, Move, View>({
  setup: (ctx) => …,                  // the game as it starts
  turn: (state) => [state.next],      // whose move it is; [] once it's over
  move(state, side, move, ctx) {      // a move from a side whose turn it is
    if (!valid(move)) return refuse('Pick a square.')
    …
    return state                      // the state after it
  },
  view: (state, side) => …,           // what a side sees (null: a watcher)
  result: (state) => …,               // { winners: [sides] }, or null while it goes on
  moves: (state, side) => […],        // optional, but worth it: every move a side could make now
  timeout: (state, side, ctx) => …,   // optional: the clock ran out (play for them, or pass)
  leave: (state, side, ctx) => …,     // optional: the game without someone who left
})
```

**`moves()` is optional, but worth writing.** With it you get:

- bots in the simulator, so you can test a 4-player game alone;
- fuzzing, which plays hundreds of random games to find bugs;
- a fair default when a player's clock runs out: Kampuse plays one of their moves at random.

Keep its order the same for the same state.

The golden rules:

1. **Only plain JSON in the state**: objects, arrays, strings, numbers, booleans, null. No classes,
   `Date`, `Map`, `undefined` or functions.
2. **Use `ctx.random()` and `ctx.now`**, never `Math.random()` or `Date.now()`. Kampuse replays games
   from their moves to check results. A game must come out the same every time.
3. **Keep nothing outside the state.** No variables at the top of the file that change. Each call gets
   the state and returns the new one. You may change the state you're given and return it.
4. **Check every move.** It comes from a player's phone. Refuse anything odd with a short reason in
   English. Your screen can translate it, as the XOX example does.
5. **Show each player only what they may see.** With hidden cards, `view` leaves out the others' hands.
6. **Be quick.** Each call should take well under 50 ms. Rules can't use the network, storage or timers.

Kampuse does the rest: seats, invites, the turn clock, watchers, chat, and who left.

- Only moves from a side whose turn it is reach your rules.
- Three turns in a row left to the clock count as leaving.
- **When the clock runs out:** `timeout()` decides. Without it, a random move from `moves()` is played. Without either, it counts as
  leaving.
- **When someone leaves:** `leave()` decides. Without it, the game ends, and everyone still in wins.

## Testing your rules

Rules are plain functions, so you can test them like any other code, without a browser:

```ts
// games/my-game/rules.test.ts (npm test runs every rules.test.ts)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fuzz, startGame } from '@kampuse/games-kit/testing'
import rules from './rules'

test('three in a row wins', () => {
  const game = startGame(rules, { players: 2, seed: 7 })   // the same seed, the same game
  const first = game.turn[0]
  game.move(first, { cell: 0 })                            // { ok: true }, or { refused: 'reason' }
  …
  assert.deepEqual(game.over, { winners: [first] })
  assert.ok(game.replays())
})

test('500 random games, no problems', () => {
  const report = fuzz(rules, { games: 500, players: 2 })   // needs moves()
  assert.deepEqual(report.problems, [])
})
```

A test game behaves as a Kampuse table does. It refuses moves out of turn and after the end, and has `timeout(side)` and
`leave(side)`. It also gives `view(side)`, `moves(side)`, `state`, `steps`, and `notes` (warnings such as `Math.random` used). A bug
in the rules throws a `RulesError` that says what is wrong.

`fuzz()` plays random games from `moves()`, now and then letting the clock run out or leaving. It checks every view at every step,
and reports:

- rules that throw;
- `moves()` listing a move that `move()` refuses;
- a turn with nothing to play;
- a side that has left still being given turns;
- games that never end;
- games that don't replay the same;
- every warning the checks give.

`examples/xox/rules.test.ts` is a full example.

## Limits

| | |
|---|---|
| A move | 4 KB of JSON |
| A view | 16 KB of JSON |
| The state | 64 KB of JSON |
| One rules call | 50 ms |
| Moves a second, per player | 10 |
| Turns left to the clock before it counts as leaving | 3 |

## What the simulator checks

The log (with **Problems only** to filter) and the **Game state** tab show:

- every message between each screen and the table;
- rules that throw, return something that isn't plain JSON, or go over a limit;
- rules that use `Math.random` or `Date.now`;
- a bot's move from `moves()` that `move()` refuses;
- rules stuck in a loop (stopped after 2 s, then loaded again);
- moves that are too big or too fast, and messages the kit doesn't know;
- a **replay check** at the end of every game, which plays it again from its moves in freshly loaded
  rules and compares the end. A ✗ means the rules depend on something besides the state and `ctx`.

Each screen loads from another address than the simulator (`localhost` or `127.0.0.1`), as it will
inside Kampuse. The buttons under each screen:

- **🤖 Bot:** a bot plays that seat, from `moves()`. Seat bots in every chair and watch a whole game.
- **⏸ Pause:** acts as if the student closed the phone app.
- **↻ Reload:** reloads one screen mid-game.
- **🚪 Leave:** that player leaves the table.

**🎲 Fuzz** plays 200 random games in freshly loaded rules and logs every problem. The **Game state** tab shows the state, and what
each player and the watcher sees, side by side. Compare them to catch something one player shouldn't see.

## Before a game goes to Kampuse

These are drafts; we'll settle them with the first developers:

- It works on a phone at 360×640, in Turkish and English.
- Everything it loads is in its own folder: no outside scripts, trackers or ads, and no collecting
  anything about players.
- It's fit for a campus: no gambling with real value, nothing hateful or sexual.
- It's small: aim for under 5 MB in all, since phones also run the 3D campus.
- We review every version before students see it, and can take a game down.

## For those not using the kit's code

The messages are in `src/protocol.ts`. Every message carries `kampuse: 1`. The screen says `hello`
until Kampuse answers `welcome`, then gets `view`, `refused`, `players`, `pause` and `resume`. It sends
`move`, `leave` and `score`.

## Contributing

Issues and pull requests to the kit are welcome: bugs, clearer docs, more examples, better checks. To bring a
game to Kampuse, open an issue with what it is and a link to its folder; for now we invite a few games at a
time.

## License

MIT, see [LICENSE](LICENSE). Your games are yours: the licence covers this kit, not what you make with it.
