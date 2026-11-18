// The commit a branch's checks diff from: its merge-base with the branch it merges into. checkChanges.ts,
// checkMigrations.ts, mutateDiff.ts and test/storage/storedValues.test.ts take it from here.
import { execFileSync } from 'node:child_process'

/**
 * The branch this one merges into, as `check:static` passes it: CHECK_BASE, or origin/main when that is unset or empty,
 * as `${CHECK_BASE:-origin/main}` in package.json.
 */
export function checkBase(env: NodeJS.ProcessEnv = process.env): string {
  return env.CHECK_BASE || 'origin/main'
}

/** The merge-base of `base` and HEAD in the repo at `root`. A `base` the repo doesn't have fails saying so, and how to get it. */
export function mergeBase(root: string, base: string): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    throw new Error(`no ${base} here to check this branch against: fetch it (\`git fetch origin\`), or set CHECK_BASE to the branch this one merges into`)
  }
  return git('merge-base', base, 'HEAD')
}
