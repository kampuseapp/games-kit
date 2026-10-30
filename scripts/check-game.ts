// `npm run check-game -- games/my-game`: the checks a game must pass before Kampuse takes it. The kampuseapp/games
// repository runs exactly these on every pull request, so run them first.
//
// 1. Files: only a game's own kinds of file, small, no links, no dependencies.
// 2. game.json: complete and valid.
// 3. Code, read without running it: no network, no eval, no storage or cookies, no outside addresses, no frames or
//    forms, imports only from the kit and the game's own folder, and rules that use nothing but the kit.
// 4. Only if all of that passes: the rules, fuzzed (hundreds of random games, replayed), and the game's tests. Each
//    runs in a separate process with a time limit and almost no environment.
//
// These checks catch mistakes and the obvious; they are not what keeps players safe. Kampuse runs every game's screen
// in a sealed frame on another site with no network, and its rules in a sealed space of their own (SECURITY.md in
// kampuseapp/games). Maintainers: never run a pull request's code on your own machine; CI runs it.

import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkManifest, type Manifest } from '../src/manifest'

const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** What a game may hold. */
const FILES = {
  bytes: 1_000_000,
  total: 5_000_000,
  count: 200,
  kinds: new Set(['.ts', '.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp3', '.ogg', '.wav', '.m4a', '.woff2']),
  text: new Set(['.ts', '.js', '.mjs', '.html', '.css', '.json', '.md', '.txt', '.svg']),
}
/** The kit's own modules, and what a test may also use. */
const KIT_IMPORTS = new Set(['@kampuse/games-kit', '@kampuse/games-kit/rules'])
const TEST_IMPORTS = new Set(['@kampuse/games-kit/testing', '@kampuse/games-kit/rules', 'node:test', 'node:assert', 'node:assert/strict'])
const NO_DEPENDENCIES = new Set(['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb', 'bun.lock', 'node_modules'])

type Problem = { file: string; line?: number; text: string }

// ---------- what code may not do (scripts, inline scripts and SVG) ----------

const IN_CODE: [RegExp, string][] = [
  [/\bfetch\s*\(/, 'fetch(): a game has no network.'],
  [/\bXMLHttpRequest\b/, 'XMLHttpRequest: a game has no network.'],
  [/\bWebSocket\b/, 'WebSocket: a game has no network (moves go through the kit).'],
  [/\bEventSource\b/, 'EventSource: a game has no network.'],
  [/\bsendBeacon\b/, 'sendBeacon: a game has no network.'],
  [/\bRTC(?:PeerConnection|DataChannel)\b/, 'WebRTC: a game has no network.'],
  [/\bimportScripts\b/, 'importScripts: a game loads nothing from outside.'],
  [/\bnew\s+(?:Shared)?Worker\s*\(/, 'Workers are not allowed in a game.'],
  [/\beval\s*\(/, 'eval(): code built from text is not allowed.'],
  [/\bnew\s+Function\s*\(|\bFunction\s*\(\s*['"`]/, 'Function(): code built from text is not allowed.'],
  [/\bset(?:Timeout|Interval)\s*\(\s*['"`]/, 'A timer with code as text is not allowed: pass a function.'],
  [/\[\s*['"`]constructor['"`]\s*\]|\.constructor\s*\.\s*constructor\b/, 'Reaching Function through "constructor" is not allowed.'],
  [/\bdocument\s*\.\s*cookie\b/, 'Cookies: a game keeps nothing in the browser.'],
  [/\b(?:localStorage|sessionStorage|indexedDB)\b/, 'Browser storage: a game keeps nothing in the browser (ask us if your game needs to remember something).'],
  [/\b(?:top|parent|opener)\s*\.\s*location\b|\bwindow\s*\.\s*open\s*\(|\blocation\s*\.\s*(?:href\s*=[^=]|assign\s*\(|replace\s*\()/, 'A game never navigates or opens windows.'],
  [/\bdocument\s*\.\s*domain\b/, 'document.domain is not allowed.'],
  [/\bnavigator\s*\.\s*(?:geolocation|mediaDevices|clipboard|serviceWorker|credentials|usb|bluetooth|hid|serial|share)\b/, 'That browser feature is not available to games.'],
  [/\bimport\s*\(\s*(?!['"])/, 'import() of a computed path is not allowed.'],
]
/** In the rules (and what they import): nothing of a browser or a server. They run on Kampuse's side, sealed. */
const IN_RULES: [RegExp, string][] = [
  [/\b(?:window|document|navigator|globalThis|self|process|Deno|Bun)\b/, 'Rules see nothing of a browser or a server: only their state, the move and ctx.'],
  [/\brequire\s*\(/, 'require(): rules import only from the kit and their own folder.'],
  [/\b(?:Math\s*\.\s*random|Date\s*\.\s*now|new\s+Date\s*\(|performance\s*\.\s*now)\b/, 'Use ctx.random and ctx.now in rules, so a game replays the same.'],
]
/** In tests: they run in CI, so nothing of the machine. */
const IN_TESTS: [RegExp, string][] = [
  [/\b(?:process|globalThis|Deno|Bun)\b|\brequire\s*\(/, 'Tests use only node:test, node:assert and the kit: nothing of the machine they run on.'],
]
const OUTSIDE_URL: [RegExp, string] = [/https?:\/\/(?!www\.w3\.org\/(?:2000\/svg|1999\/xlink|1999\/xhtml)\b)/i, 'An outside address: everything a game uses lives in its own folder.']
const RELATIVE_OUTSIDE: [RegExp, string] = [/(?:\b(?:src|href|action|srcset|poster|data)\s*=\s*["']?\s*|url\(\s*["']?\s*)\/\//i, 'An outside address: everything a game uses lives in its own folder.']
const IN_HTML: [RegExp, string][] = [
  [/<\s*(?:iframe|frame|object|embed|applet|portal|base|form)\b/i, 'Frames, embeds, <base> and forms are not allowed in a game.'],
  [/<\s*meta\b[^>]*\bhttp-equiv\b/i, '<meta http-equiv> is not allowed.'],
  [/<\s*link\b[^>]*\brel\s*=\s*["']?(?:preconnect|dns-prefetch|prefetch|prerender|manifest)\b/i, 'Prefetching and manifests are not allowed.'],
  [/<\s*a\b[^>]*\bhref\s*=\s*["']?(?!#)/i, 'Links out are not allowed: a game never navigates.'],
]
const IN_SVG: [RegExp, string][] = [
  [/<\s*script\b/i, 'An SVG with a script is not allowed.'],
  [/<\s*foreignObject\b/i, 'An SVG with foreignObject is not allowed.'],
  [/\son[a-z]+\s*=/i, 'An SVG with event handlers (on…=) is not allowed.'],
]
const IN_CSS: [RegExp, string][] = [[/@import\b/i, '@import is not allowed: link your CSS from index.html.']]

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

function scan(file: string, text: string, rules: [RegExp, string][], out: Problem[]) {
  for (const [pattern, message] of rules) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
    for (const m of text.matchAll(global)) out.push({ file, line: lineOf(text, m.index ?? 0), text: message })
  }
}

/** Every module a file imports (static, re-exported and literal dynamic imports). */
function importsOf(text: string): { spec: string; index: number }[] {
  const found: { spec: string; index: number }[] = []
  const patterns = [/\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]/g, /\bexport\s+(?:type\s+)?[\w*{}\s,$]*?\s+from\s+['"]([^'"]+)['"]/g, /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g]
  for (const p of patterns) for (const m of text.matchAll(p)) found.push({ spec: m[1], index: m.index ?? 0 })
  return found
}

/** The code inside an HTML page's <script> tags, and the files its tags load. */
function scriptsOf(html: string): { code: string; srcs: { url: string; index: number }[] } {
  let code = ''
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) code += `${m[1]}\n`
  const srcs: { url: string; index: number }[] = []
  for (const m of html.matchAll(/<(?:script|link|img|audio|video|source)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']*)["']/gi)) srcs.push({ url: m[1], index: m.index ?? 0 })
  return { code, srcs }
}

/** Whether a path a file uses stays inside the game's folder. */
const staysInside = (gameDir: string, fromFile: string, spec: string) => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(spec) || spec.startsWith('/') || spec.startsWith('\\')) return false
  const target = resolve(dirname(fromFile), spec)
  return target === gameDir || target.startsWith(gameDir + sep)
}

// ---------- the checks ----------

function listFiles(dir: string, problems: Problem[], root = dir): string[] {
  const files: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name)
    const rel = relative(root, path)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) {
      problems.push({ file: rel, text: 'Links (symlinks) are not allowed.' })
      continue
    }
    if (NO_DEPENDENCIES.has(name)) {
      problems.push({ file: rel, text: 'A game has no dependencies of its own: it uses only the kit.' })
      continue
    }
    if (name.startsWith('.')) {
      problems.push({ file: rel, text: 'Hidden files are not allowed.' })
      continue
    }
    if (!/^[A-Za-z0-9._-]+$/.test(name)) {
      problems.push({ file: rel, text: 'File names may use only letters, digits, dots, dashes and underscores.' })
      continue
    }
    if (stat.isDirectory()) files.push(...listFiles(path, problems, root))
    else if (stat.isFile()) files.push(path)
    else problems.push({ file: rel, text: 'Only files and folders are allowed.' })
  }
  return files
}

/** The rules and every file of the game they import, followed from rules.ts. */
function rulesFiles(gameDir: string, problems: Problem[]): Set<string> {
  const seen = new Set<string>()
  const visit = (file: string) => {
    if (seen.has(file) || !existsSync(file)) return
    seen.add(file)
    const text = readFileSync(file, 'utf8')
    for (const { spec, index } of importsOf(text)) {
      if (spec === '@kampuse/games-kit/rules') continue
      if (!spec.startsWith('.')) {
        problems.push({ file: relative(gameDir, file), line: lineOf(text, index), text: `Rules import only '@kampuse/games-kit/rules' and the game's own files, not '${spec}'.` })
        continue
      }
      const base = resolve(dirname(file), spec)
      const target = [base, `${base}.ts`, `${base}.js`, join(base, 'index.ts')].find((p) => existsSync(p) && lstatSync(p).isFile())
      if (target) visit(target)
    }
  }
  visit(join(gameDir, 'rules.ts'))
  return seen
}

function checkFiles(gameDir: string, files: string[], manifest: Manifest, problems: Problem[]) {
  const rel = (f: string) => relative(gameDir, f)
  let total = 0
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    const size = lstatSync(file).size
    total += size
    if (!FILES.kinds.has(ext)) problems.push({ file: rel(file), text: `"${ext || basename(file)}" files are not allowed in a game.` })
    if (size > FILES.bytes) problems.push({ file: rel(file), text: `${Math.round(size / 1000)} KB: a file may be at most ${FILES.bytes / 1_000_000} MB.` })
  }
  if (files.length > FILES.count) problems.push({ file: '.', text: `${files.length} files: a game may have at most ${FILES.count}.` })
  if (total > FILES.total) problems.push({ file: '.', text: `${(total / 1_000_000).toFixed(1)} MB in all: a game may be at most ${FILES.total / 1_000_000} MB.` })
  if (!existsSync(join(gameDir, 'index.html'))) problems.push({ file: 'index.html', text: 'Missing: the screen starts here.' })
  if (manifest.kind === 'table' && !existsSync(join(gameDir, 'rules.ts'))) problems.push({ file: 'rules.ts', text: 'Missing: a table game needs its rules.' })
  return total
}

function checkCode(gameDir: string, files: string[], problems: Problem[]) {
  const rel = (f: string) => relative(gameDir, f)
  const rules = existsSync(join(gameDir, 'rules.ts')) ? rulesFiles(gameDir, problems) : new Set<string>()
  for (const file of files) {
    const ext = extname(file).toLowerCase()
    if (!FILES.text.has(ext) || ext === '.md' || ext === '.txt' || ext === '.json') continue
    const text = readFileSync(file, 'utf8')
    const name = rel(file)
    const isTest = /\.test\.(?:ts|js|mjs)$/.test(file)
    scan(name, text, [OUTSIDE_URL, RELATIVE_OUTSIDE], problems)
    if (ext === '.css') {
      scan(name, text, IN_CSS, problems)
      continue
    }
    if (ext === '.svg') {
      scan(name, text, IN_SVG, problems)
      continue
    }
    const code = ext === '.html' ? scriptsOf(text).code : text
    if (ext === '.html') {
      scan(name, text, IN_HTML, problems)
      for (const { url, index } of scriptsOf(text).srcs)
        if (!staysInside(gameDir, file, url)) problems.push({ file: name, line: lineOf(text, index), text: `"${url}" is outside the game's folder.` })
    }
    scan(name, code, IN_CODE, problems)
    if (rules.has(file)) scan(name, text, IN_RULES, problems)
    if (isTest) scan(name, text, IN_TESTS, problems)
    for (const { spec, index } of importsOf(code)) {
      const allowed = isTest ? TEST_IMPORTS.has(spec) || KIT_IMPORTS.has(spec) : KIT_IMPORTS.has(spec)
      if (allowed) continue
      if (spec.startsWith('.') && staysInside(gameDir, file, spec)) continue
      const line = ext === '.html' ? undefined : lineOf(text, index)
      problems.push({ file: name, line, text: `Imports '${spec}': a game imports only the kit${isTest ? ', node:test, node:assert' : ''} and its own files.` })
    }
  }
}

// ---------- running the game's code, sealed off ----------

const viteNode = join(dirname(createRequire(import.meta.url).resolve('vite-node/package.json')), 'dist', 'cli.mjs')

/** Runs one of the kit's scripts on the game in a process of its own, with a time limit and almost no environment. */
function sealed(script: string, args: string[], seconds: number): { ok: boolean; out: string; timedOut: boolean } {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', NO_COLOR: '1' }
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
  const res = spawnSync(process.execPath, [viteNode, '--config', join(KIT, 'vite.config.ts'), join(KIT, 'scripts', script), '--', ...args], {
    cwd: KIT,
    env,
    encoding: 'utf8',
    timeout: seconds * 1000,
    // Killed outright at the limit: code stuck in a loop never gets to handle a gentler signal.
    killSignal: 'SIGKILL',
    maxBuffer: 16 * 1024 * 1024,
  })
  const timedOut = (res.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT'
  return { ok: res.status === 0 && !res.error, out: `${res.stdout ?? ''}${res.stderr ?? ''}`, timedOut }
}

// ---------- the report ----------

function main() {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('-'))
  if (!arg) {
    console.error('Usage: npm run check-game -- games/<id>')
    process.exit(2)
  }
  const gameDir = resolve(process.cwd(), arg)
  if (!existsSync(gameDir) || !lstatSync(gameDir).isDirectory()) {
    console.error(`No folder at ${arg}.`)
    process.exit(2)
  }
  const folder = basename(gameDir)
  const problems: Problem[] = []
  const say = (ok: boolean, text: string) => console.log(`${ok ? '✓' : '✗'} ${text}`)
  const show = (list: Problem[]) => {
    for (const p of list) console.log(`    ${p.file}${p.line ? `:${p.line}` : ''}: ${p.text}`)
  }

  // 1. The files.
  const files = listFiles(gameDir, problems)
  let manifest: Manifest | null = null
  let raw: unknown = null
  const jsonPath = join(gameDir, 'game.json')
  if (!existsSync(jsonPath)) problems.push({ file: 'game.json', text: 'Missing.' })
  else
    try {
      raw = JSON.parse(readFileSync(jsonPath, 'utf8'))
    } catch (e) {
      problems.push({ file: 'game.json', text: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` })
    }
  const checked = checkManifest(raw ?? {}, folder)
  manifest = checked.manifest
  console.log(`Checking ${arg} (${manifest.kind} game "${manifest.name}")\n`)
  const total = checkFiles(gameDir, files, manifest, problems)
  const fileProblems = problems.splice(0)
  say(!fileProblems.length, `files: ${files.length}, ${Math.max(1, Math.round(total / 1000))} KB`)
  show(fileProblems)

  // 2. game.json.
  const jsonProblems = checked.problems.map((text) => ({ file: 'game.json', text }))
  say(!jsonProblems.length, 'game.json')
  show(jsonProblems)

  // 3. The code, read without running it.
  checkCode(gameDir, files, problems)
  const codeProblems = problems.splice(0)
  say(!codeProblems.length, 'code: no network, no eval, no storage, nothing from outside')
  show(codeProblems)

  const failedBefore = fileProblems.length + jsonProblems.length + codeProblems.length
  if (failedBefore) {
    console.log(`\nFAIL: ${failedBefore} problem${failedBefore > 1 ? 's' : ''}. Nothing of the game was run.`)
    process.exit(1)
  }

  // 4. The game's own code, sealed: its rules fuzzed, then its tests.
  let failed = 0
  let stuck = false
  if (manifest.kind === 'table') {
    const counts = Array.from({ length: manifest.players.max - manifest.players.min + 1 }, (_, i) => manifest.players.min + i)
    const run = sealed('run-rules.ts', [gameDir, ...counts.map(String)], 180)
    let report: { error?: string; has?: { moves: boolean }; runs?: { players: number; games: number; ended: number; problems: { text: string; game: number; step: number; times: number; example?: string }[] }[] } = {}
    try {
      report = JSON.parse(run.out.slice(run.out.indexOf('{"kit-report"')).split('\n')[0])['kit-report']
    } catch {
      stuck = run.timedOut
      report = { error: run.timedOut ? 'The rules did not finish within 3 minutes (a loop that never ends?).' : `The rules could not run:\n${run.out.trim().slice(-1500)}` }
    }
    if (report.error) {
      failed++
      say(false, 'rules')
      console.log(`    ${report.error}`)
    } else if (!report.has?.moves) {
      failed++
      say(false, 'rules: moves() is missing. Kampuse needs it to fuzz your rules and to play for someone whose clock runs out.')
    } else
      for (const r of report.runs ?? []) {
        const ok = !r.problems.length && r.ended === r.games
        if (!ok) failed++
        say(ok, `rules: ${r.games} random games for ${r.players} players, ${r.ended} ended${ok ? ', no problems, all replay the same' : ''}`)
        for (const p of r.problems) console.log(`    ${p.text} (game ${p.game + 1}, step ${p.step}${p.times > 1 ? `, ${p.times} times` : ''})${p.example ? ` move: ${p.example}` : ''}`)
        if (r.ended < r.games && !r.problems.length) console.log(`    ${r.games - r.ended} games did not end.`)
      }
  }
  const tests = files.filter((f) => /\.test\.(?:ts|js|mjs)$/.test(f))
  if (tests.length && stuck) {
    failed++
    say(false, 'tests: not run, since the rules never finished')
  } else if (tests.length) {
    const run = sealed('run-tests.ts', tests, 180)
    const pass = run.out.match(/^# pass (\d+)/m)?.[1] ?? '0'
    const fail = run.out.match(/^# fail (\d+)/m)?.[1] ?? '?'
    if (!run.ok) failed++
    say(run.ok, run.timedOut ? 'tests: did not finish within 3 minutes' : `tests: ${pass} passed${run.ok ? '' : `, ${fail} failed`}`)
    if (!run.ok) console.log(run.out.split('\n').filter((l) => /^not ok|^\s+(?:error|expected|actual):|Error/.test(l)).slice(0, 20).map((l) => `    ${l.trim()}`).join('\n'))
  } else console.log('· tests: none (a rules.test.ts is worth writing: see examples/xox)')

  if (failed) {
    console.log(`\nFAIL: ${failed} check${failed > 1 ? 's' : ''} did not pass.`)
    process.exit(1)
  }
  console.log(`\nPASS: ${arg} is ready for a pull request to kampuseapp/games.`)
}

main()
