// Which changed lines a mutation run mutates (scripts/mutateDiff.ts).

const SOURCE = /^src\/.*\.ts$/
/** Run only in a browser, so no test runs it and every mutant would survive: its demo checks it, as #114 agreed. */
const UNTESTED = ['src/app/webMain.ts']
/** A `git diff -U0` hunk header: the lines it adds start at `start` and run for `count`, 1 when it's left out. */
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

/**
 * What Stryker should mutate, as its `--mutate` patterns: the lines `diff` (`git diff -U0`) adds or changes in the
 * TypeScript source the tests run, as `path:start-end` ranges, and each of the `untracked` files throughout. Mutating
 * only those lines, not each changed file throughout, keeps a branch that moves files from mutating code it didn't
 * change: a file moved unchanged has no lines to mutate.
 */
export function mutationTargets(diff: string, untracked: string[]): string[] {
  const targets: string[] = []
  let path: string | undefined
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      path = line.startsWith('+++ b/') ? line.slice('+++ b/'.length) : undefined
      continue
    }
    const hunk = HUNK.exec(line)
    if (!hunk || path === undefined || !isMutated(path)) continue
    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    if (count > 0) targets.push(`${path}:${start}-${start + count - 1}`)
  }
  return [...targets, ...untracked.filter(isMutated)]
}

/** The TypeScript source the tests run. */
function isMutated(path: string): boolean {
  return SOURCE.test(path) && !UNTESTED.includes(path)
}
