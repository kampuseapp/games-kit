// The games the simulator can open: every folder under examples/ and games/ with a game.json.

import type { GameKind } from '../src/protocol'

/** A game's game.json, checked, with where its files are. */
export type GameMeta = {
  id: string
  name: string
  emoji: string
  kind: GameKind
  players: { min: number; max: number }
  /** Seconds a turn may take before the clock runs out (table games). */
  turnSeconds: number
  about: string
  /** The folder, from the kit's root: its screen is index.html there, its rules rules.ts. */
  folder: string
  /** What is wrong with the game.json, if anything. */
  problems: string[]
}

const metas = import.meta.glob<Record<string, unknown>>(['/examples/*/game.json', '/games/*/game.json'], { eager: true, import: 'default' })
const screens = new Set(Object.keys(import.meta.glob(['/examples/*/index.html', '/games/*/index.html'], { query: '?url', import: 'default' })))
const rules = new Set(Object.keys(import.meta.glob(['/examples/*/rules.ts', '/games/*/rules.ts'])))

function check(path: string, raw: Record<string, unknown>): GameMeta {
  const folder = path.slice(1, path.lastIndexOf('/'))
  const problems: string[] = []
  const str = (key: string, fallback: string) => {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    problems.push(`"${key}" is missing.`)
    return fallback
  }
  const id = str('id', folder.split('/').pop()!)
  if (!/^[a-z0-9-]{2,24}$/.test(id)) problems.push('"id" must be 2 to 24 lowercase letters, digits or dashes.')
  const kind: GameKind = raw.kind === 'solo' ? 'solo' : 'table'
  if (raw.kind !== 'solo' && raw.kind !== 'table') problems.push('"kind" must be "table" or "solo".')
  const p = (raw.players ?? {}) as { min?: unknown; max?: unknown }
  let min = Number.isInteger(p.min) ? (p.min as number) : kind === 'solo' ? 1 : 2
  let max = Number.isInteger(p.max) ? (p.max as number) : min
  if (kind === 'table' && (min < 2 || max > 4 || min > max)) {
    problems.push('"players" must be { "min": 2…4, "max": min…4 } for a table game.')
    min = Math.min(4, Math.max(2, min))
    max = Math.min(4, Math.max(min, max))
  }
  if (kind === 'solo') min = max = 1
  const turnSeconds = Number.isInteger(raw.turnSeconds) && (raw.turnSeconds as number) >= 5 && (raw.turnSeconds as number) <= 300 ? (raw.turnSeconds as number) : 30
  if (kind === 'table' && raw.turnSeconds !== undefined && turnSeconds !== raw.turnSeconds) problems.push('"turnSeconds" must be 5 to 300.')
  if (!screens.has(`/${folder}/index.html`)) problems.push('index.html (the screen) is missing.')
  if (kind === 'table' && !rules.has(`/${folder}/rules.ts`)) problems.push('rules.ts is missing: a table game needs its rules.')
  return { id, name: str('name', id), emoji: typeof raw.emoji === 'string' ? raw.emoji : '🎲', kind, players: { min, max }, turnSeconds, about: typeof raw.about === 'string' ? raw.about : '', folder, problems }
}

/** Your games first (games/), then the examples. */
export const GAMES: GameMeta[] = Object.entries(metas)
  .map(([path, raw]) => check(path, raw))
  .sort((a, b) => Number(a.folder.startsWith('examples/')) - Number(b.folder.startsWith('examples/')) || a.name.localeCompare(b.name))
