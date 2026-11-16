// Migration check: a branch adds at most one step to MIGRATIONS and edits none that main has released.
// Compares src/storage/sqliteStorage.ts at HEAD with the same file at the merge-base with main (default origin/main,
// or the ref passed as the first argument). Steps are found by their `// N:` comment, numbered from 1.
// Run with `npm run check:migrations`; exits 1 with the reason when the branch breaks either rule.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const FILE = 'src/storage/sqliteStorage.ts'
const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

/** Each step's text, in order, from the `const MIGRATIONS` array: a step runs from its `// N:` comment to the next. */
function stepsOf(source: string, where: string): string[] {
  const block = /^const MIGRATIONS[^\n]*\n([\s\S]*?)^\]/m.exec(source)?.[1]
  if (block === undefined) throw new Error(`${where}: no \`const MIGRATIONS\` array in ${FILE}`)
  const parts = block.split(/^(?=  \/\/ \d+:)/m).filter((part) => /^  \/\/ \d+:/.test(part))
  parts.forEach((part, i) => {
    const number = Number(/^  \/\/ (\d+):/.exec(part)![1])
    if (number !== i + 1) throw new Error(`${where}: step comment \`// ${number}:\` should be \`// ${i + 1}:\``)
  })
  return parts.map((part) => part.trimEnd())
}

const mainRef = process.argv[2] ?? 'origin/main'
const base = git('merge-base', mainRef, 'HEAD').trim()
const released = stepsOf(git('show', `${base}:${FILE}`), `${mainRef} (${base.slice(0, 7)})`)
const branch = stepsOf(readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8'), 'HEAD')

const problems: string[] = []
released.forEach((step, i) => {
  if (branch[i] !== step) problems.push(`step ${i + 1} is released on ${mainRef}; append a new step instead of editing it`)
})
const added = branch.length - released.length
if (added > 1) {
  problems.push(
    `this branch adds ${added} steps (${released.length + 1}–${branch.length}); a branch into main adds at most one, ` + 'so fold them into one step',
  )
}
if (added < 0) problems.push(`this branch removes released steps ${branch.length + 1}–${released.length}`)

if (problems.length > 0) {
  console.error(`Migration check failed (${FILE}):\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`Migration check passed: ${released.length} released steps unchanged, ${added} added.`)
