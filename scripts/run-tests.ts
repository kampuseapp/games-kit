// Run by check-game.ts in a process of its own: a game's test files (node:test). Not meant to be run by hand.
import { pathToFileURL } from 'node:url'

for (const file of process.argv.slice(2)) await import(pathToFileURL(file).href)
