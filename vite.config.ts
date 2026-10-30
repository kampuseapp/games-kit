// The simulator's dev server: `npm run dev`, then open http://127.0.0.1:5390.
import { fileURLToPath } from 'node:url'
import { defineConfig, normalizePath, type Plugin } from 'vite'

/** The kit's folder, with forward slashes on every system. */
const root = normalizePath(fileURLToPath(new URL('.', import.meta.url))).replace(/\/?$/, '/')

/**
 * Saving a game's files, without losing the game in progress:
 * - its rules.ts: the simulator starts a new game with the new rules;
 * - its screen's code (or index.html): only the screens reload, and the game goes on;
 * - its CSS: updated in place, as usual;
 * - its game.json: the simulator reloads.
 */
const gameReload: Plugin = {
  name: 'kampuse-kit-game-reload',
  handleHotUpdate({ file, server }) {
    const found = normalizePath(file).slice(root.length).match(/^((?:examples|games)\/[^/]+)\/(.+)$/)
    if (!found) return
    const [, folder, name] = found
    if (name === 'game.json' || name.endsWith('.css')) return
    if (name.endsWith('.test.ts')) return []
    server.ws.send({ type: 'custom', event: name === 'rules.ts' ? 'kit:rules' : 'kit:screen', data: { folder } })
    return []
  },
}

export default defineConfig({
  root,
  resolve: {
    alias: [
      { find: /^@kampuse\/games-kit\/rules$/, replacement: `${root}src/rules.ts` },
      { find: /^@kampuse\/games-kit\/testing$/, replacement: `${root}src/testing.ts` },
      { find: /^@kampuse\/games-kit$/, replacement: `${root}src/index.ts` },
    ],
  },
  // On this machine only. Screens load from "localhost" when the simulator is on 127.0.0.1 (and the other way round),
  // so each screen is another origin, as it is in Kampuse.
  server: { host: '127.0.0.1', port: 5390, strictPort: true },
  worker: { format: 'es' },
  plugins: [gameReload],
})
