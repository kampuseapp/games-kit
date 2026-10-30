// A game's game.json: what it must say. Checked the same way by the simulator, by `npm run check-game`, and by
// Kampuse when it takes a game in.

import type { GameKind } from './protocol'

/** A game's id: 2 to 24 lowercase letters, digits or dashes. It is also its folder's name, and never changes. */
export const GAME_ID = /^[a-z0-9-]{2,24}$/

export type Manifest = {
  id: string
  name: string
  emoji: string
  kind: GameKind
  players: { min: number; max: number }
  /** Seconds a turn may take before the clock runs out (table games). */
  turnSeconds: number
  about: string
}

/** A game.json read and checked: the manifest (with defaults where it is wrong) and what is wrong with it. */
export function checkManifest(raw: unknown, folder: string): { manifest: Manifest; problems: string[] } {
  const problems: string[] = []
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  if (r !== raw) problems.push('game.json must be an object.')
  const text = (key: string, fallback: string, max: number) => {
    const v = r[key]
    if (typeof v === 'string' && v.trim()) {
      if (v.trim().length > max) problems.push(`"${key}" is longer than ${max} characters.`)
      return v.trim().slice(0, max)
    }
    problems.push(`"${key}" is missing.`)
    return fallback
  }
  const id = text('id', folder, 24)
  if (!GAME_ID.test(id)) problems.push('"id" must be 2 to 24 lowercase letters, digits or dashes.')
  else if (id !== folder) problems.push(`"id" is "${id}", but the folder is "${folder}": they must be the same.`)
  const name = text('name', id, 40)
  const kind: GameKind = r.kind === 'solo' ? 'solo' : 'table'
  if (r.kind !== 'solo' && r.kind !== 'table') problems.push('"kind" must be "table" or "solo".')
  const p = (r.players && typeof r.players === 'object' ? r.players : {}) as { min?: unknown; max?: unknown }
  let min = Number.isInteger(p.min) ? (p.min as number) : kind === 'solo' ? 1 : 2
  let max = Number.isInteger(p.max) ? (p.max as number) : min
  if (kind === 'table' && (min < 2 || max > 4 || min > max)) {
    problems.push('"players" must be { "min": 2…4, "max": min…4 } for a table game.')
    min = Math.min(4, Math.max(2, min))
    max = Math.min(4, Math.max(min, max))
  }
  if (kind === 'solo') min = max = 1
  const t = r.turnSeconds
  const turnSeconds = Number.isInteger(t) && (t as number) >= 5 && (t as number) <= 300 ? (t as number) : 30
  if (t !== undefined && turnSeconds !== t) problems.push('"turnSeconds" must be a whole number from 5 to 300.')
  const emoji = typeof r.emoji === 'string' && r.emoji.length <= 8 ? r.emoji : '🎲'
  if (r.emoji !== undefined && emoji !== r.emoji) problems.push('"emoji" must be one emoji.')
  const about = typeof r.about === 'string' ? r.about.slice(0, 200) : ''
  if (typeof r.about === 'string' && r.about.length > 200) problems.push('"about" is longer than 200 characters.')
  const known = new Set(['id', 'name', 'emoji', 'kind', 'players', 'turnSeconds', 'about'])
  for (const key of Object.keys(r)) if (!known.has(key)) problems.push(`"${key}" is not a game.json field.`)
  return { manifest: { id, name, emoji, kind, players: { min, max }, turnSeconds, about }, problems }
}
