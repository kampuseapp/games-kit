// Arı Avı: a solo game. There are no rules to run: the screen plays the round and reports the score.
// (A solo game's score is the phone's word, so Kampuse keeps solo boards friendly, not prized.)
import { connect } from '@kampuse/games-kit'

const ROUND_MS = 30_000
const WORDS = {
  tr: { title: 'Arı Avı 🐝', how: '30 saniye: kaçmadan önce arılara dokun. Altın arı 5 puan.', play: 'Başla', again: 'Tekrar', score: '{n} puan' },
  en: { title: 'Bee Hunt 🐝', how: '30 seconds: tap the bees before they fly off. A golden bee is 5 points.', play: 'Play', again: 'Again', score: '{n} points' },
}

const kampuse = await connect('ari')
const w = WORDS[kampuse.lang]
const field = document.getElementById('field')!
const card = document.getElementById('card')!
const scoreEl = document.getElementById('score')!
const timeEl = document.getElementById('time')!

let score = 0
let left = 0
let paused = false
let timer = 0

function showCard(title: string, text: string, label: string) {
  card.hidden = false
  card.innerHTML = `<h1>${title}</h1><p>${text}</p><button>${label}</button>`
  card.querySelector('button')!.addEventListener('click', start)
}

function start() {
  card.hidden = true
  score = 0
  left = ROUND_MS
  scoreEl.textContent = '0'
  kampuse.score(0)
  clearInterval(timer)
  timer = window.setInterval(tick, 100)
}

function tick() {
  if (paused) return
  left -= 100
  timeEl.textContent = `${Math.ceil(left / 1000)} s`
  if (Math.random() < 0.16) spawn()
  if (left > 0) return
  clearInterval(timer)
  field.replaceChildren()
  timeEl.textContent = ''
  kampuse.score(score, true)
  showCard(w.title, w.score.replace('{n}', String(score)), w.again)
}

function spawn() {
  const gold = Math.random() < 0.08
  const bee = document.createElement('button')
  bee.className = `bee${gold ? ' gold' : ''}`
  bee.textContent = '🐝'
  bee.style.left = `${10 + Math.random() * 80}%`
  bee.style.top = `${15 + Math.random() * 75}%`
  bee.addEventListener('pointerdown', () => {
    score += gold ? 5 : 1
    scoreEl.textContent = String(score)
    kampuse.score(score)
    bee.remove()
  })
  field.append(bee)
  setTimeout(() => bee.remove(), gold ? 700 : 1200)
}

// Put away for a moment (the phone app closed): the round waits.
kampuse.on('pause', () => (paused = true))
kampuse.on('resume', () => (paused = false))

showCard(w.title, w.how, w.play)
