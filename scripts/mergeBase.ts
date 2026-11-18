// The commit a branch's checks diff from: its merge-base with released main, or with the branch it merges into.
// checkChanges.ts, checkMigrations.ts, mutateDiff.ts and test/storage/storedValues.test.ts take it from here.
import { execFileSync } from 'node:child_process'

/**
 * Released main: what saved data and a released schema come from, so what the migration and stored-value checks
 * compare against, whatever branch this one merges into.
 */
export const MAIN_REF = 'origin/main'

/** How to get a missing MAIN_REF. */
export const MAIN_REF_HINT = 'fetch it (`git fetch origin`)'

/** How to get a missing base `check:static` passes to `check:changes`: `${CHECK_BASE:-origin/main}` in package.json. */
export const CHECK_BASE_HINT = `${MAIN_REF_HINT}, or set CHECK_BASE to the branch this one merges into`

/**
 * The merge-base of `base` and HEAD in the repo at `root`. A `base` the repo doesn't have fails naming it, and saying
 * `howToGetIt`, as the caller takes its base.
 */
export function mergeBase(root: string, base: string, howToGetIt: string): string {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`)
  } catch {
    throw new Error(`no ${base} here to check this branch against: ${howToGetIt}`)
  }
  return git('merge-base', base, 'HEAD')
}
