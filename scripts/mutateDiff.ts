// Mutation tests the source lines a branch changes, rather than all of src/, which takes much longer.
// The changes are everything since the merge-base with <base> (main by default), committed or not,
// new files included; scripts/mutationTargets.ts picks the lines to mutate. A file moved without `git mv` is untracked
// until it's added, so it's mutated throughout until then.
// `npm run test:mutation` or `node scripts/mutateDiff.ts [base]`; the report is in reports/mutation/.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mergeBase } from './mergeBase.ts'
import { mutationTargets } from './mutationTargets.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
// a large branch's diff is more than execFileSync's default 1 MB of output, as in checkChanges.ts
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const paths = (output: string): string[] => output.split('\0').filter(Boolean)

const base = process.argv[2] ?? 'main'
const baseCommit = mergeBase(root, base, 'pass the branch this one merges into: `npm run test:mutation -- <branch>`')
// Added, copied, modified or renamed files: a deleted file has nothing to mutate. Renames are found, so a moved file's
// unchanged lines aren't mutated. The prefixes are pinned, as diff.noprefix or diff.mnemonicPrefix would change them.
const diff = git(
  ...['-c', 'core.quotePath=false', 'diff', '-U0', '--find-renames', '--diff-filter=ACMR', '--no-color', '--no-ext-diff'],
  ...['--src-prefix=a/', '--dst-prefix=b/', baseCommit],
)
const targets = mutationTargets(diff, paths(git('ls-files', '--others', '--exclude-standard', '-z')))

if (targets.length === 0) {
  console.log(`No source lines added or changed since ${base}: nothing to mutate.`)
  process.exit(0)
}

console.log(`Mutating the source changed since ${base}, as lines (path:start-end) or whole new files:\n${targets.map((t) => `  ${t}`).join('\n')}\n`)
try {
  execFileSync('npx', ['stryker', 'run', '--mutate', targets.join(',')], { cwd: root, stdio: 'inherit' })
} catch {
  process.exit(1)
}
