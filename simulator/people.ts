// The students the simulator seats at a table: made up, with a hexagon for a face.

import type { Player } from '../src/protocol'

const INK = '#0e2148'

/** A square picture: a hexagon in the student's colour with their initial, as an SVG data URL. */
function face(name: string, color: string): string {
  const hex = '48,4 86,26 86,70 48,92 10,70 10,26'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><polygon points="${hex}" fill="${color}" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/><text x="48" y="61" text-anchor="middle" font-family="system-ui, sans-serif" font-size="38" font-weight="800" fill="${INK}">${name[0]}</text></svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const PEOPLE = [
  { username: 'ayse', name: 'Ayşe', color: '#ffc233' },
  { username: 'mert', name: 'Mert', color: '#2bb673' },
  { username: 'zeynep', name: 'Zeynep', color: '#b9a4f5' },
  { username: 'can', name: 'Can', color: '#ff8a8d' },
]

/** The players for a game of `n`, by side. */
export const seatsFor = (n: number): Player[] =>
  PEOPLE.slice(0, n).map((p, side) => ({ side, username: p.username, name: p.name, avatar: face(p.name, p.color), in: true }))

/** Someone watching. */
export const watcher = (): Player => ({ side: -1, username: 'deniz', name: 'Deniz', avatar: face('Deniz', '#bfe3f5'), in: true })
