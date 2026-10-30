// `npm test`: runs every rules.test.ts in examples/ and games/ (they use node:test).
const files = import.meta.glob(['/examples/*/rules.test.ts', '/games/*/rules.test.ts'])
for (const [path, load] of Object.entries(files)) {
  console.log(`# ${path.slice(1)}`)
  await load()
}
