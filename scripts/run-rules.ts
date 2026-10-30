// Run by check-game.ts in a process of its own: loads a game's rules and fuzzes them for each number of players,
// then prints one line, {"kit-report": …}, for check-game to read. Not meant to be run by hand.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fuzz, rulesOf } from '../src/judge'

const [dir, ...counts] = process.argv.slice(2)
const say = (report: unknown) => console.log(JSON.stringify({ 'kit-report': report }))

try {
  const mod = await import(pathToFileURL(join(dir, 'rules.ts')).href)
  const { rules, has } = rulesOf(mod, [])
  if (!has.moves) say({ has })
  else
    say({
      has,
      runs: counts.map(Number).map((players) => {
        const report = fuzz(rules, { games: 300, players, seed: 7 + players })
        return { players, games: report.games, ended: report.ended, problems: report.problems }
      }),
    })
} catch (e) {
  say({ error: e instanceof Error ? e.message : String(e) })
}
