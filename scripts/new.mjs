#!/usr/bin/env node
// `npm run new -- <id> [--solo]`: a new game in games/<id>, copied from an example (XOX for a table game,
// Arı Avı for a solo one), with its id and name changed. Then open the simulator and pick it.
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const kit = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const id = args.find((a) => !a.startsWith('-'))
const solo = args.includes('--solo')

if (!id || !/^[a-z0-9-]{2,24}$/.test(id)) {
  console.error('Usage: npm run new -- <id> [--solo]\nThe id is 2 to 24 lowercase letters, digits or dashes, e.g. my-game.')
  process.exit(1)
}
const from = join(kit, 'examples', solo ? 'ari' : 'xox')
const to = join(kit, 'games', id)
if (existsSync(to)) {
  console.error(`games/${id} is there already.`)
  process.exit(1)
}

cpSync(from, to, { recursive: true })
const name = id.replace(/(^|-)([a-z])/g, (_, dash, c) => (dash ? ' ' : '') + c.toUpperCase())
const meta = JSON.parse(readFileSync(join(to, 'game.json'), 'utf8'))
writeFileSync(join(to, 'game.json'), `${JSON.stringify({ ...meta, id, name, about: '' }, null, 2)}\n`)
// The screen connects with the game's id.
const screen = join(to, 'screen.ts')
writeFileSync(screen, readFileSync(screen, 'utf8').replace(/connect(<[^>]*>)?\('(xox|ari)'\)/, (_, type = '') => `connect${type}('${id}')`))

console.log(`Made games/${id} from the ${solo ? 'Arı Avı' : 'XOX'} example.
- game.json: the name, players and turn clock
- index.html, screen.ts, style.css: what players see${solo ? '' : '\n- rules.ts: what the game allows (and rules.test.ts, its tests: npm test)'}
Run npm run dev and pick "${name}" in the simulator.`)
