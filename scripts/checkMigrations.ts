// Migration check: a branch adds at most one step to MIGRATIONS and edits none that main has released.
// Compares src/storage/sqliteStorage.ts at HEAD with the same file at the merge-base with main (the ref passed as the
// first argument, else CHECK_BASE, else origin/main, as check:static's base). Steps are found by their `// N:` comment, numbered from 1.
// Run with `npm run check:migrations`; exits 1 with the reason when the branch breaks either rule.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { checkBase, GET_CHECK_BASE, mergeBase } from './mergeBase.ts'
import { MIGRATIONS_FILE, migrationSteps } from './migrationSteps.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

const given = process.argv[2]
const mainRef = given ?? checkBase()
const base = mergeBase(root, mainRef, given === undefined ? GET_CHECK_BASE : 'fetch it (`git fetch origin`), or pass a branch this repo has')
const released = migrationSteps(git('show', `${base}:${MIGRATIONS_FILE}`), `${mainRef} (${base.slice(0, 7)})`)
const branch = migrationSteps(readFileSync(new URL(`../${MIGRATIONS_FILE}`, import.meta.url), 'utf8'), 'HEAD')

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
  console.error(`Migration check failed (${MIGRATIONS_FILE}):\n${problems.map((p) => `- ${p}`).join('\n')}`)
  process.exit(1)
}
console.log(`Migration check passed: ${released.length} released steps unchanged, ${added} added.`)
