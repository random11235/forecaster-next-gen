// Pre-commit checks on the staged files, run by .husky/pre-commit:
// 1. Prettier: each staged file Prettier covers is formatted (`npm run format` fixes it).
// 2. File size: no staged code or docs file is over 5,000 tokens (scripts/fileSize.ts), with guidance on splitting.
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { oversized, splitGuidance } from './fileSize.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' })

const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z').split('\0').filter(Boolean)
let failed = false

if (staged.length > 0) {
  const prettier = spawnSync('npx', ['prettier', '--check', '--ignore-unknown', '--', ...staged], { cwd: root, stdio: 'inherit' })
  if (prettier.status !== 0) {
    console.error('\nPrettier: run `npm run format` (or `npx prettier --write <file>`), then stage the result.\n')
    failed = true
  }
}

// the staged content's size, not the working tree's: that is what the commit holds
const sized = staged.map((path) => ({ path, bytes: Number(git('cat-file', '-s', `:${path}`).trim()) }))
const tooBig = oversized(sized)
if (tooBig.length > 0) {
  console.error(splitGuidance(tooBig))
  failed = true
}

process.exit(failed ? 1 : 0)
