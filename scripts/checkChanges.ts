// Checks the files a commit or branch changes, on the content it holds rather than the files on disk:
// 1. Prettier: each file Prettier covers is formatted (scripts/formatting.ts; `npm run format` fixes it).
// 2. File size: no code or docs file is over 5,000 tokens (scripts/fileSize.ts), with guidance on splitting.
// 3. Change file, for a branch only: one that changes the app adds a change file and leaves the version and the
//    CHANGELOG.md entries to the release (scripts/changeFiles.ts).
// `node scripts/checkChanges.ts` checks the staged files: .husky/pre-commit runs it.
// `node scripts/checkChanges.ts <base>` checks the files changed since the merge-base with <base>: `check:static` runs
// it, so the pre-push hook and CI do.
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { changeFileProblems } from './changeFiles.ts'
import { oversized, splitGuidance } from './fileSize.ts'
import { unformatted } from './formatting.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]): Buffer => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })

const base = process.argv[2]
// added, copied, modified or renamed: a deleted file has nothing to check
const changed = (
  base === undefined
    ? git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z')
    : git('diff', '--name-only', '--diff-filter=ACMR', '-z', `${base}...HEAD`)
)
  .toString('utf8')
  .split('\0')
  .filter(Boolean)
// the index for a commit, HEAD for a branch
const committed = (path: string): Buffer => git('show', base === undefined ? `:${path}` : `HEAD:${path}`)
const files = changed.map((path) => ({ path, held: committed(path) }))
let failed = false

const notFormatted = await unformatted(files.map(({ path, held }) => ({ path, content: held.toString('utf8') })))
if (notFormatted.length > 0) {
  console.error(`Not formatted with Prettier:\n${notFormatted.map((path) => `  ${path}`).join('\n')}`)
  console.error('Run `npm run format` (or `npx prettier --write <file>`), then stage the result.\n')
  failed = true
}

const tooBig = oversized(files.map(({ path, held }) => ({ path, bytes: held.length })))
if (tooBig.length > 0) {
  console.error(splitGuidance(tooBig))
  failed = true
}

if (base !== undefined) {
  const mergeBase = git('merge-base', base, 'HEAD').toString('utf8').trim()
  // deleted files too: deleting a source file changes the app
  const branchChanged = git('diff', '--name-only', '-z', mergeBase, 'HEAD').toString('utf8').split('\0').filter(Boolean)
  const held = (ref: string, path: string): string | undefined => {
    const listed = git('ls-tree', '--name-only', ref, '--', path).toString('utf8').trim()
    return listed === path ? git('show', `${ref}:${path}`).toString('utf8') : undefined
  }
  const problems = changeFileProblems(branchChanged, (path, at) => held(at === 'base' ? mergeBase : 'HEAD', path))
  if (problems.length > 0) {
    console.error(`Change file:\n${problems.map((problem) => `  ${problem}`).join('\n')}\n`)
    failed = true
  }
}

process.exit(failed ? 1 : 0)
