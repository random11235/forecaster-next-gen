// Mutation tests the source a branch changes, rather than all of src/, which takes much longer.
// The changes are everything since the merge-base with <base> (main by default), committed or not,
// new files included; scripts/mutationTargets.ts picks the ones to mutate.
// `npm run test:mutation` or `node scripts/mutateDiff.ts [base]`; the report is in reports/mutation/.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mergeBase as mergeBaseWith } from './mergeBase.ts'
import { mutationTargets } from './mutationTargets.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const paths = (output: string): string[] => output.split('\0').filter(Boolean)

const base = process.argv[2] ?? 'main'
const mergeBase = mergeBaseWith(root, base)
// added, copied, modified or renamed: a deleted file has nothing to mutate
const changed = [...paths(git('diff', '--name-only', '--diff-filter=ACMR', '-z', mergeBase)), ...paths(git('ls-files', '--others', '--exclude-standard', '-z'))]
const targets = mutationTargets(changed)

if (targets.length === 0) {
  console.log(`No source changed since ${base}: nothing to mutate.`)
  process.exit(0)
}

console.log(`Mutating ${targets.length} file(s) changed since ${base}:\n${targets.map((t) => `  ${t}`).join('\n')}\n`)
try {
  execFileSync('npx', ['stryker', 'run', '--mutate', targets.join(',')], { cwd: root, stdio: 'inherit' })
} catch {
  process.exit(1)
}
