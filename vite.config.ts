// The simulator's dev server: `npm run dev`, then open http://127.0.0.1:5390.
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

const root = fileURLToPath(new URL('.', import.meta.url))

/** Tells the simulator when a game's rules.ts is saved, so it starts a new game with the new rules. */
const rulesReload: Plugin = {
  name: 'kampuse-kit-rules-reload',
  handleHotUpdate({ file, server }) {
    if (file.endsWith('/rules.ts')) server.ws.send({ type: 'custom', event: 'kit:rules', data: { file } })
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
  plugins: [rulesReload],
})
