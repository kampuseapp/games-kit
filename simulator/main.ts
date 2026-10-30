// The simulator: a game played at a pretend Kampuse table. Each player's screen runs in a frame of its
// own, from another origin (as it will in Kampuse), and the table runs the rules as Kampuse would. A log
// shows every message and every problem the kit noticed; the state tab shows what the rules keep.

import type { FuzzReport } from '../src/judge'
import { envelope, isScreenMsg, type HostMsg, type Player } from '../src/protocol'
import { GAMES, type GameMeta } from './games'
import { seatsFor, watcher } from './people'
import { RulesRunner } from './rules-client'
import { Table, type Level, type Who } from './table'

// ---------- tiny DOM helpers ----------

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined>
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, ''), v)
    else if (k === 'class') el.className = String(v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids) if (kid !== null && kid !== false) el.append(kid)
  return el
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// ---------- settings, kept in the address so a reload comes back to the same game ----------

const params = new URLSearchParams(location.search)
const settings = {
  game: params.get('game') ?? GAMES[0]?.id ?? '',
  players: Number(params.get('players')) || 0,
  clock: params.get('clock') !== 'off',
  lang: (params.get('lang') === 'en' ? 'en' : 'tr') as 'tr' | 'en',
  watch: params.get('watch') !== 'off',
}
const remember = () => {
  const q = new URLSearchParams({ game: settings.game, players: String(settings.players), clock: settings.clock ? 'on' : 'off', lang: settings.lang, watch: settings.watch ? 'on' : 'off' })
  history.replaceState(null, '', `?${q}`)
}

/** Screens load from the other name for this machine, so they are another origin, as in Kampuse. */
const screenOrigin = `${location.protocol}//${location.hostname === '127.0.0.1' ? 'localhost' : '127.0.0.1'}:${location.port}`

// ---------- the log ----------

type Entry = { at: number; level: Level; who: string; text: string; data?: unknown }
const entries: Entry[] = []
let problemsOnly = false

function log(level: Level, who: string, text: string, data?: unknown) {
  entries.push({ at: Date.now(), level, who, text, data })
  if (entries.length > 600) entries.splice(0, entries.length - 600)
  if (level !== 'info') console[level === 'error' ? 'error' : 'warn'](`[kit] ${who}: ${text}`)
  drawLog()
}

function drawLog() {
  const list = $('log')
  const near = list.scrollHeight - list.scrollTop - list.clientHeight < 40
  const shown = problemsOnly ? entries.filter((e) => e.level !== 'info') : entries
  list.replaceChildren(
    ...shown.slice(-300).map((e) => {
      const time = new Date(e.at).toLocaleTimeString([], { hour12: false })
      const head = h('div', { class: 'entry-head' }, h('span', { class: 'entry-time' }, time), h('b', {}, e.who), h('span', {}, e.text))
      if (e.data === undefined) return h('div', { class: `entry ${e.level}` }, head)
      return h('details', { class: `entry ${e.level}` }, h('summary', {}, head), h('pre', {}, JSON.stringify(e.data, null, 2)))
    }),
  )
  const problems = entries.filter((e) => e.level !== 'info').length
  $('problems').textContent = problems ? String(problems) : ''
  if (near) list.scrollTop = list.scrollHeight
}

// ---------- the frames ----------

type Frame = { who: Who; player: Player; iframe: HTMLIFrameElement; el: HTMLElement; status: HTMLElement; bot: HTMLButtonElement | null; ready: boolean; paused: boolean }
const frames = new Map<Who, Frame>()
const whoName = (who: Who) => frames.get(who)?.player.name ?? String(who)

function post(who: Who, msg: HostMsg) {
  const frame = frames.get(who)
  if (!frame?.ready || !frame.iframe.contentWindow) return
  frame.iframe.contentWindow.postMessage(envelope(msg), screenOrigin)
  log('info', `→ ${frame.player.name}`, msg.t, msg)
}

function frameFor(who: Who, player: Player, game: GameMeta): Frame {
  const iframe = h('iframe', {
    src: `${screenOrigin}/${game.folder}/index.html`,
    title: `${game.name}: ${player.name}'s screen`,
    // Scripts only; no forms, pop-ups or navigating Kampuse away.
    sandbox: 'allow-scripts allow-same-origin',
    allow: 'autoplay',
  })
  const status = h('span', { class: 'seat-status' })
  const bot =
    who !== 'w' && game.kind === 'table'
      ? h('button', { class: 'btn btn-small', title: 'A bot plays this seat: a random move from rules.moves() on its turn' }, '🤖 Bot')
      : null
  bot?.addEventListener('click', () => {
    if (!table || who === 'w') return
    if (!runner?.has?.moves) return log('warn', 'kit', 'Bots pick from rules.moves(): add moves() to the rules first.')
    table.setBot(who, !table.bots.has(who))
  })
  const frame: Frame = { who, player, iframe, el: null as unknown as HTMLElement, status, bot, ready: false, paused: false }
  const pauseBtn = h('button', { class: 'btn btn-small', title: 'As if the student closed the phone app for a moment' }, '⏸ Pause')
  pauseBtn.addEventListener('click', () => {
    frame.paused = !frame.paused
    pauseBtn.textContent = frame.paused ? '▶ Resume' : '⏸ Pause'
    post(who, { t: frame.paused ? 'pause' : 'resume' })
    frame.el.classList.toggle('paused', frame.paused)
  })
  frame.el = h(
    'section',
    { class: `seat${who === 'w' ? ' watching' : ''}` },
    h('header', { class: 'seat-top' }, h('img', { src: player.avatar, alt: '' }), h('b', {}, player.name), h('span', { class: 'chip' }, who === 'w' ? 'watching' : `side ${who}`), status),
    h('div', { class: 'phone' }, iframe),
    h(
      'footer',
      { class: 'seat-actions' },
      who !== 'w' && game.kind === 'table' ? h('button', { class: 'btn btn-small', onclick: () => table?.leave(who as number), title: 'Leave the table (counts as losing)' }, '🚪 Leave') : null,
      bot,
      pauseBtn,
      h('button', { class: 'btn btn-small', onclick: () => { frame.ready = false; iframe.src = iframe.src }, title: 'Reload this screen (the game goes on)' }, '↻ Reload'),
    ),
  )
  return frame
}

// ---------- the game ----------

let game: GameMeta | undefined
let table: Table | null = null
let runner: RulesRunner | null = null
/** The last fuzz run's report, for the state tab. */
let fuzzed: FuzzReport | null = null
/** Solo games: each round's score, by player. */
const scores: { name: string; score: number; final: boolean; at: number }[] = []

async function newGame() {
  table?.close()
  table = null
  fuzzed = null
  runner?.terminate()
  runner = null
  frames.clear()
  scores.length = 0
  $('tables').replaceChildren()
  game = GAMES.find((g) => g.id === settings.game) ?? GAMES[0]
  if (!game) {
    $('tables').append(h('p', { class: 'empty' }, 'No games found. Make a folder in games/ with a game.json, an index.html and (for a table game) a rules.ts. See README.md.'))
    return draw()
  }
  settings.game = game.id
  const n = game.kind === 'solo' ? 1 : Math.min(game.players.max, Math.max(game.players.min, settings.players || game.players.min))
  settings.players = n
  remember()
  drawControls()
  log('info', 'kit', `New game: ${game.name}, ${n} player${n > 1 ? 's' : ''}.`)
  for (const problem of game.problems) log('warn', 'game.json', problem)

  const seats = seatsFor(n)
  if (game.kind === 'table') {
    runner = new RulesRunner(`/${game.folder}/rules.ts`)
    const loaded = await runner.load()
    for (const note of loaded.notes) log(note.level, 'rules', note.text)
    if (!loaded.ok) {
      log('error', 'rules', loaded.error)
      $('tables').append(h('p', { class: 'empty' }, `The rules did not load: ${loaded.error}`))
      return draw()
    }
    table = new Table(game, seats, runner, settings.clock, { send: post, log, changed: draw })
  }
  for (const player of seats) frames.set(player.side, frameFor(player.side, player, game))
  if (game.kind === 'table' && settings.watch) frames.set('w', frameFor('w', watcher(), game))
  $('tables').replaceChildren(...[...frames.values()].map((f) => f.el))
  await table?.start()
  draw()
}

// Messages from the screens: only from our own frames, and only the kit's.
window.addEventListener('message', (e) => {
  const frame = [...frames.values()].find((f) => f.iframe.contentWindow === e.source)
  if (!frame || !game) return
  if (e.origin !== screenOrigin) return log('warn', frame.player.name, `A message from ${e.origin}, not the screen's own origin: ignored.`)
  if (!isScreenMsg(e.data)) return log('warn', frame.player.name, 'sent a message the kit does not know (ignored).', e.data)
  const msg = e.data
  if (msg.t !== 'hello' || !frame.ready) log('info', `← ${frame.player.name}`, msg.t, msg)
  switch (msg.t) {
    case 'hello': {
      if (msg.game !== game.id) log('warn', frame.player.name, `The screen connected as "${msg.game}", but game.json says "${game.id}".`)
      const first = !frame.ready
      frame.ready = true
      const players = table ? table.seats : [frame.player]
      post(frame.who, { t: 'welcome', game: game.id, kind: game.kind, me: frame.player, players, lang: settings.lang, watching: frame.who === 'w' })
      const view = table?.viewFor(frame.who)
      if (view) post(frame.who, view)
      if (frame.paused) post(frame.who, { t: 'pause' })
      if (first) draw()
      break
    }
    case 'move':
      if (game.kind === 'solo') log('warn', frame.player.name, 'Solo games have no moves: report the score with score().')
      else void table?.move(frame.who, msg.move)
      break
    case 'leave':
      if (table && frame.who !== 'w') void table.leave(frame.who)
      else log('info', frame.player.name, 'left the game.')
      break
    case 'score': {
      if (game.kind === 'table') {
        log('warn', frame.player.name, 'score() is for solo games. A table game ends when rules.result says so.')
        break
      }
      if (typeof msg.score !== 'number' || !Number.isFinite(msg.score)) {
        log('warn', frame.player.name, 'A score must be a number.', msg)
        break
      }
      const open = scores.find((s) => s.name === frame.player.name && !s.final)
      if (open) Object.assign(open, { score: msg.score, final: msg.final, at: Date.now() })
      else scores.push({ name: frame.player.name, score: msg.score, final: msg.final, at: Date.now() })
      if (msg.final) log('info', frame.player.name, `finished a round with ${msg.score}.`)
      draw()
      break
    }
  }
})

// ---------- fuzzing ----------

/** Plays 200 random games in rules loaded afresh, picking from moves(), and logs what broke. */
async function runFuzz() {
  if (!game || game.kind !== 'table') return
  const button = $<HTMLButtonElement>('fuzz')
  button.disabled = true
  button.textContent = '🎲 Fuzzing…'
  const players = settings.players
  const fresh = new RulesRunner(`/${game.folder}/rules.ts`)
  try {
    const res = await fresh.ask({ op: 'fuzz', opts: { games: 200, players, seed: (Math.random() * 2 ** 32) >>> 0 } }, 60_000)
    if (!res.ok) return log('error', 'fuzz', res.error)
    const report = res.report!
    fuzzed = report
    const names = seatsFor(players).map((p) => p.name)
    const wins = report.wins.map((n, side) => `${names[side]} ${n}`).join(', ')
    log(
      report.problems.length ? 'warn' : 'info',
      'fuzz',
      `${report.games} random games, ${players} players: ${report.ended} ended (wins: ${wins}; draws ${report.draws}), ${report.steps} moves, ${report.ms} ms. ${report.problems.length ? `${report.problems.length} problem${report.problems.length > 1 ? 's' : ''}:` : 'No problems. ✓'}`,
    )
    for (const p of report.problems)
      log('error', 'fuzz', `${p.text} (first in game ${p.game + 1}, step ${p.step}${p.times > 1 ? `; ${p.times} times` : ''})`, p.example === undefined ? undefined : { move: p.example })
  } catch (e) {
    log('error', 'fuzz', e instanceof Error ? e.message : String(e))
  } finally {
    fresh.terminate()
    button.disabled = false
    button.textContent = '🎲 Fuzz'
    draw()
  }
}

// ---------- drawing ----------

function drawControls() {
  const select = $<HTMLSelectElement>('game')
  select.replaceChildren(...GAMES.map((g) => h('option', { value: g.id, selected: g.id === settings.game }, `${g.emoji} ${g.name}${g.folder.startsWith('examples/') ? ' (example)' : ''}`)))
  const g = GAMES.find((x) => x.id === settings.game)
  const players = $<HTMLSelectElement>('players')
  players.replaceChildren()
  if (g && g.kind === 'table') for (let n = g.players.min; n <= g.players.max; n++) players.append(h('option', { value: n, selected: n === settings.players }, `${n} players`))
  players.hidden = !g || g.kind !== 'table' || g.players.min === g.players.max
  $<HTMLInputElement>('clock').checked = settings.clock
  $<HTMLInputElement>('watch').checked = settings.watch
  $('clock-wrap').hidden = $('watch-wrap').hidden = $('fuzz').hidden = !g || g.kind !== 'table'
  $<HTMLSelectElement>('lang').value = settings.lang
}

function seatStatus(frame: Frame): string {
  if (!frame.ready) return 'connecting…'
  if (!table) return ''
  if (frame.who === 'w') return table.over ? 'game over' : ''
  const seat = table.seats[frame.who]
  if (!seat.in) return 'left'
  if (table.over) return table.over.winners.includes(frame.who) ? '🏆 won' : table.over.winners.length ? 'lost' : 'draw'
  if (!table.turn.includes(frame.who)) return ''
  if (table.ends === null) return '⏳ your turn'
  return `⏳ ${Math.max(0, Math.ceil((table.ends - Date.now()) / 1000))} s`
}

function draw() {
  for (const frame of frames.values()) {
    frame.status.textContent = seatStatus(frame)
    frame.el.classList.toggle('turn', !!table && frame.who !== 'w' && table.turn.includes(frame.who) && !table.over)
    frame.el.classList.toggle('gone', !!table && frame.who !== 'w' && !table.seats[frame.who].in)
    if (frame.bot && table && frame.who !== 'w') {
      const on = table.bots.has(frame.who)
      frame.bot.classList.toggle('btn-honey', on)
      frame.bot.textContent = on ? '🤖 Bot ✓' : '🤖 Bot'
      frame.bot.disabled = !table.seats[frame.who].in
    }
  }
  // The state tab.
  const pane = $('state')
  if (!game) return pane.replaceChildren()
  if (game.kind === 'solo') {
    pane.replaceChildren(
      h('h3', {}, 'Scores'),
      scores.length
        ? h('ol', { class: 'scores' }, ...[...scores].sort((a, b) => b.score - a.score).map((s) => h('li', {}, h('b', {}, String(s.score)), ` ${s.name}`, s.final ? '' : ' (playing)')))
        : h('p', { class: 'muted' }, 'No score yet. The screen sends them with score(n), and score(n, true) when a round ends.'),
    )
    return
  }
  if (!table) return pane.replaceChildren(h('p', { class: 'muted' }, 'The rules did not load. See the log.'))
  const replay = { checking: '… checking', same: '✓ same end', different: '✗ different end', null: 'when the game ends' }[String(table.replay) as 'null']
  pane.replaceChildren(
    h(
      'dl',
      { class: 'facts' },
      h('dt', {}, 'step'), h('dd', {}, `${table.steps.length} (seq ${table.seq})`),
      h('dt', {}, 'turn'), h('dd', {}, table.turn.length ? table.turn.map((s) => `${whoName(s)} (${s})`).join(', ') : '–'),
      h('dt', {}, 'result'), h('dd', {}, table.over ? (table.over.winners.length ? `won: ${table.over.winners.map(whoName).join(', ')}` : 'draw') : '–'),
      h('dt', {}, 'replay'), h('dd', {}, replay),
      h('dt', {}, 'rules'), h('dd', {}, table.broken ? `✗ ${table.broken}` : (['moves', 'timeout', 'leave'] as const).map((k) => `${k}() ${runner?.has?.[k] ? '✓' : '–'}`).join(' · ')),
      h('dt', {}, 'fuzz'), h('dd', {}, fuzzed ? `${fuzzed.ended}/${fuzzed.games} ended · ${fuzzed.problems.length ? `✗ ${fuzzed.problems.length} problem(s), see the log` : '✓ no problems'}` : runner?.has?.moves ? 'not run (🎲 Fuzz)' : 'needs moves()'),
    ),
    h('h3', {}, 'State (what the rules keep)'),
    h('pre', {}, JSON.stringify(table.state, null, 2)),
    // Side by side, so anything one player may not see stands out in another's view.
    h('h3', {}, 'What each one sees'),
    h(
      'div',
      { class: 'views' },
      ...(table.shown
        ? [
            ...table.shown.views.map((v, side) => h('div', {}, h('b', {}, `${whoName(side)} (side ${side})`), h('pre', {}, JSON.stringify(v, null, 2)))),
            h('div', {}, h('b', {}, 'Watcher'), h('pre', {}, JSON.stringify(table.shown.watcher, null, 2))),
          ]
        : [h('p', { class: 'muted' }, 'Nothing yet.')]),
    ),
  )
}

// ---------- wiring ----------

$('game').addEventListener('change', (e) => {
  settings.game = (e.target as HTMLSelectElement).value
  settings.players = 0
  void newGame()
})
$('players').addEventListener('change', (e) => {
  settings.players = Number((e.target as HTMLSelectElement).value)
  void newGame()
})
$('lang').addEventListener('change', (e) => {
  settings.lang = (e.target as HTMLSelectElement).value === 'en' ? 'en' : 'tr'
  void newGame()
})
$('clock').addEventListener('change', (e) => {
  settings.clock = (e.target as HTMLInputElement).checked
  remember()
  table?.setClock(settings.clock)
})
$('watch').addEventListener('change', (e) => {
  settings.watch = (e.target as HTMLInputElement).checked
  void newGame()
})
$('new').addEventListener('click', () => void newGame())
$('fuzz').addEventListener('click', () => void runFuzz())
$('only-problems').addEventListener('change', (e) => {
  problemsOnly = (e.target as HTMLInputElement).checked
  drawLog()
})
$('clear').addEventListener('click', () => {
  entries.length = 0
  drawLog()
})
for (const tab of document.querySelectorAll<HTMLButtonElement>('[data-tab]'))
  tab.addEventListener('click', () => {
    for (const t of document.querySelectorAll<HTMLElement>('[data-tab]')) t.classList.toggle('on', t === tab)
    for (const pane of document.querySelectorAll<HTMLElement>('[data-pane]')) pane.hidden = pane.dataset.pane !== tab.dataset.tab
  })

// The clock, and the seconds left on each screen's label.
setInterval(() => {
  table?.tick()
  for (const frame of frames.values()) frame.status.textContent = seatStatus(frame)
}, 250)

// A rules.ts saved: the rules load again in a new game (screens reload by themselves).
import.meta.hot?.on('kit:rules', (data: { file: string }) => {
  if (game && data.file.includes(`/${game.folder}/`)) {
    log('info', 'kit', 'rules.ts changed: a new game with the new rules.')
    void newGame()
  }
})

drawControls()
void newGame()
