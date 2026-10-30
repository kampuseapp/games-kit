// The games the simulator can open: every folder under examples/ and games/ with a game.json.

import { checkManifest, type Manifest } from '../src/manifest'

/** A game's game.json, checked (src/manifest.ts), with where its files are. */
export type GameMeta = Manifest & {
  /** The folder, from the kit's root: its screen is index.html there, its rules rules.ts. */
  folder: string
  /** What is wrong with the game, if anything. */
  problems: string[]
}

const metas = import.meta.glob<unknown>(['/examples/*/game.json', '/games/*/game.json'], { eager: true, import: 'default' })
const screens = new Set(Object.keys(import.meta.glob(['/examples/*/index.html', '/games/*/index.html'], { query: '?url', import: 'default' })))
const rules = new Set(Object.keys(import.meta.glob(['/examples/*/rules.ts', '/games/*/rules.ts'])))

function check(path: string, raw: unknown): GameMeta {
  const folder = path.slice(1, path.lastIndexOf('/'))
  const { manifest, problems } = checkManifest(raw, folder.split('/').pop()!)
  if (!screens.has(`/${folder}/index.html`)) problems.push('index.html (the screen) is missing.')
  if (manifest.kind === 'table' && !rules.has(`/${folder}/rules.ts`)) problems.push('rules.ts is missing: a table game needs its rules.')
  return { ...manifest, folder, problems }
}

/** Your games first (games/), then the examples. */
export const GAMES: GameMeta[] = Object.entries(metas)
  .map(([path, raw]) => check(path, raw))
  .sort((a, b) => Number(a.folder.startsWith('examples/')) - Number(b.folder.startsWith('examples/')) || a.name.localeCompare(b.name))
