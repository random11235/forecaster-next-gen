// Mutation tests the source a branch changes, rather than all of src/, which takes much longer.
// The changes are everything since the merge-base with <base> (main by default), committed or not,
// new files included; scripts/mutationTargets.ts picks the lines to mutate.
// `npm run test:mutation` or `node scripts/mutateDiff.ts [base]`; the report is in reports/mutation/.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mergeBase } from './mergeBase.ts'
import { mutationTargets } from './mutationTargets.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const paths = (output: string): string[] => output.split('\0').filter(Boolean)

const base = process.argv[2] ?? 'main'
const baseCommit = mergeBase(root, base, 'pass the branch this one merges into: `npm run test:mutation -- <branch>`')
// added, copied, modified or renamed: a deleted file has nothing to mutate
const diff = git('diff', '-U0', '-M', '--no-color', '--no-ext-diff', '--diff-filter=ACMR', baseCommit)
const targets = mutationTargets(diff, paths(git('ls-files', '--others', '--exclude-standard', '-z')))

if (targets.length === 0) {
  console.log(`No source changed since ${base}: nothing to mutate.`)
  process.exit(0)
}

console.log(`Mutating ${targets.length} range(s) changed since ${base}:\n${targets.map((t) => `  ${t}`).join('\n')}\n`)
try {
  execFileSync('npx', ['stryker', 'run', '--mutate', targets.join(',')], { cwd: root, stdio: 'inherit' })
} catch {
  process.exit(1)
}
