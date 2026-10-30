// The kit for a game's screen: connect() once, then draw what you are sent and send moves back.
//
//   const kampuse = await connect<MyView>('xox')
//   kampuse.on('view', (turn) => draw(turn.view))
//   button.onclick = () => kampuse.move({ cell: 4 })

import { envelope, isHostMsg, type GameKind, type HostMsg, type Player, type ScreenMsg, type Turn, type Welcome } from './protocol'

type Events<V> = {
  /** The game as you see it, after every change (and at once when you start listening). */
  view: (turn: Turn<V>) => void
  /** Your last move was turned down, and why. */
  refused: (reason: string) => void
  /** Someone left or came back. */
  players: (players: Player[]) => void
  /** The student put the game away for a moment: stop sounds and animations. */
  pause: () => void
  /** They came back. */
  resume: () => void
}

/** The game's line to Kampuse. */
export type Kampuse<V = unknown> = {
  readonly game: string
  readonly kind: GameKind
  /** You (side -1 when watching). */
  readonly me: Player
  /** Everyone playing, by side; kept up to date. */
  readonly players: Player[]
  readonly lang: 'tr' | 'en'
  readonly watching: boolean
  /** The latest view, or null before the first. */
  readonly last: Turn<V> | null
  /** Listens for an event; returns a function that stops listening. */
  on<E extends keyof Events<V>>(event: E, fn: Events<V>[E]): () => void
  /** Sends a move for the rules to judge (table games). */
  move(move: unknown): void
  /** Leaves the game. At a table it counts as losing. */
  leave(): void
  /** Reports a score (solo games): call it as it changes, and with final = true when the round ends. */
  score(score: number, final?: boolean): void
}

/** How long connect() waits for Kampuse before it gives up (ms). */
const WAIT_MS = 10_000

/**
 * Connects to Kampuse (or the simulator) from inside its frame. Resolves once Kampuse has said who
 * you are. Rejects when the page is not opened by Kampuse.
 */
export function connect<V = unknown>(game: string): Promise<Kampuse<V>> {
  if (window.parent === window) return Promise.reject(new Error('Open this game in Kampuse or in the kit’s simulator (npm run dev).'))
  const send = (msg: ScreenMsg) => window.parent.postMessage(envelope(msg), '*')
  const listeners: { [E in keyof Events<V>]: Set<Events<V>[E]> } = { view: new Set(), refused: new Set(), players: new Set(), pause: new Set(), resume: new Set() }
  const emit = <E extends keyof Events<V>>(event: E, ...args: Parameters<Events<V>[E]>) => {
    for (const fn of listeners[event]) (fn as (...a: Parameters<Events<V>[E]>) => void)(...args)
  }

  return new Promise((resolve, reject) => {
    let state: Welcome | null = null
    let last: Turn<V> | null = null
    let paused = false

    const api: Kampuse<V> = {
      get game() { return state!.game },
      get kind() { return state!.kind },
      get me() { return state!.me },
      get players() { return state!.players },
      get lang() { return state!.lang },
      get watching() { return state!.watching },
      get last() { return last },
      on(event, fn) {
        listeners[event].add(fn)
        // Late listeners still get what they missed.
        if (event === 'view' && last) (fn as Events<V>['view'])(last)
        if (event === 'pause' && paused) (fn as Events<V>['pause'])()
        return () => void listeners[event].delete(fn)
      },
      move: (move) => send({ t: 'move', move }),
      leave: () => send({ t: 'leave' }),
      score: (score, final = false) => send({ t: 'score', score: Number.isFinite(score) ? score : 0, final }),
    }

    const onMessage = (e: MessageEvent) => {
      // Only Kampuse's own window may speak to the game.
      if (e.source !== window.parent || !isHostMsg(e.data)) return
      const msg = e.data as HostMsg
      switch (msg.t) {
        case 'welcome': {
          const first = !state
          state = { game: msg.game, kind: msg.kind, me: msg.me, players: msg.players, lang: msg.lang, watching: msg.watching }
          if (first) {
            clearInterval(hello)
            clearTimeout(giveUp)
            resolve(api)
          } else emit('players', state.players)
          break
        }
        case 'view': {
          if (last && msg.seq < last.seq) return
          // Kampuse's clock to this device's.
          const ends = msg.ends === null ? null : msg.ends - msg.now + Date.now()
          last = { view: msg.view as V, turn: msg.turn, ends, seq: msg.seq, over: msg.over }
          emit('view', last)
          break
        }
        case 'refused':
          emit('refused', msg.reason)
          break
        case 'players':
          if (state) state.players = msg.players
          emit('players', msg.players)
          break
        case 'pause':
          paused = true
          emit('pause')
          break
        case 'resume':
          paused = false
          emit('resume')
          break
      }
    }
    window.addEventListener('message', onMessage)

    // Hello until Kampuse answers (its frame may still be setting up).
    send({ t: 'hello', game })
    const hello = setInterval(() => send({ t: 'hello', game }), 250)
    const giveUp = setTimeout(() => {
      clearInterval(hello)
      window.removeEventListener('message', onMessage)
      reject(new Error('Kampuse did not answer. Is this page open in the simulator?'))
    }, WAIT_MS)
  })
}
