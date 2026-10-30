// XOX's screen: draws what Kampuse sends and sends taps back as moves. It never decides anything
// itself: the rules (rules.ts) judge every move, and the next view shows what happened.
import { connect, type Turn } from '@kampuse/games-kit'
import type { View } from './rules'

const WORDS = {
  tr: {
    you: 'Sen', yourTurn: 'Sıra sende', theirTurn: '{name} oynuyor', won: '{name} kazandı!', youWon: 'Kazandın! 🎉', draw: 'Berabere',
    watching: 'İzliyorsun', left: 'kalktı', leave: 'Masadan kalk', 'Pick a square.': 'Bir kare seç.',
    'That square is taken.': 'O kare dolu.', 'Not your turn.': 'Sıra sende değil.', 'The game is over.': 'Oyun bitti.',
  },
  en: {
    you: 'You', yourTurn: 'Your turn', theirTurn: '{name} is playing', won: '{name} won!', youWon: 'You won! 🎉', draw: 'Draw',
    watching: 'Watching', left: 'left', leave: 'Leave the table', 'Pick a square.': 'Pick a square.',
    'That square is taken.': 'That square is taken.', 'Not your turn.': 'Not your turn.', 'The game is over.': 'The game is over.',
  },
}

const kampuse = await connect<View>('xox')
const words: Record<string, string> = WORDS[kampuse.lang]
const say = (key: string, vars: Record<string, string> = {}) => (words[key] ?? key).replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
const MARKS = ['X', 'O']

const app = document.getElementById('app')!
app.innerHTML = `
  <div class="players"></div>
  <div class="status"></div>
  <div class="board"></div>
  ${kampuse.watching ? '' : `<button class="leave">${say('leave')}</button>`}`
const playersEl = app.querySelector<HTMLElement>('.players')!
const statusEl = app.querySelector<HTMLElement>('.status')!
const boardEl = app.querySelector<HTMLElement>('.board')!
app.querySelector('.leave')?.addEventListener('click', () => kampuse.leave())

const cells = Array.from({ length: 9 }, (_, i) => {
  const button = document.createElement('button')
  button.className = 'cell'
  button.addEventListener('click', () => kampuse.move({ cell: i }))
  boardEl.append(button)
  return button
})

function draw(turn: Turn<View> | null) {
  const mine = !kampuse.watching && !!turn?.turn.includes(kampuse.me.side)
  playersEl.innerHTML = kampuse.players
    .map((p) => `
      <div class="player${turn?.turn.includes(p.side) ? ' now' : ''}${p.in ? '' : ' gone'}">
        <img src="${escape(p.avatar)}" alt="">
        <div><b>${escape(p.name)}</b><small>${p.side === kampuse.me.side ? say('you') : p.in ? '' : say('left')}</small></div>
        <span class="mark">${MARKS[p.side]}</span>
      </div>`)
    .join('')
  if (!turn) return
  turn.view.cells.forEach((c, i) => {
    const button = cells[i]
    button.textContent = c === null ? '' : MARKS[c]
    button.className = `cell${c === 0 ? ' x' : c === 1 ? ' o' : ''}${turn.view.line?.includes(i) ? ' win' : ''}${c === null && mine ? ' open' : ''}`
    button.disabled = !mine || c !== null
  })
  statusEl.innerHTML = statusText(turn, mine)
}

function statusText(turn: Turn<View>, mine: boolean): string {
  if (turn.over) {
    const [winner] = turn.over.winners
    if (winner === undefined) return say('draw')
    return winner === kampuse.me.side ? say('youWon') : say('won', { name: escape(kampuse.players[winner].name) })
  }
  const clock = turn.ends === null ? '' : ` <span class="clock">${Math.max(0, Math.ceil((turn.ends - Date.now()) / 1000))}</span>`
  if (mine) return say('yourTurn') + clock
  const name = kampuse.players[turn.turn[0]]?.name ?? ''
  return (kampuse.watching ? `${say('watching')} · ` : '') + say('theirTurn', { name: escape(name) }) + clock
}

function escape(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

let toastTimer = 0
kampuse.on('refused', (reason) => {
  document.querySelector('.toast')?.remove()
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = say(reason)
  document.body.append(toast)
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toast.remove(), 1800)
})
kampuse.on('view', draw)
kampuse.on('players', () => draw(kampuse.last))
// The seconds left, ticking.
setInterval(() => kampuse.last && !kampuse.last.over && (statusEl.innerHTML = statusText(kampuse.last, !kampuse.watching && kampuse.last.turn.includes(kampuse.me.side))), 500)
draw(kampuse.last)
