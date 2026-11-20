// Which changed lines a mutation run mutates (scripts/mutateDiff.ts).

const SOURCE = /^src\/.*\.ts$/
/** Run only in a browser, so no test runs it and every mutant would survive: its demo checks it, as #114 agreed. */
const UNTESTED = ['src/app/webMain.ts']
const FILE = /^\+\+\+ b\/(.+)$/
const HUNK = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/

const mutated = (path: string): boolean => SOURCE.test(path) && !UNTESTED.includes(path)

/**
 * What Stryker should mutate: the lines of the TypeScript source the tests run that a branch adds or changes, as
 * `path:first-last`, read from its `git diff -U0`, and the files not yet committed, whole. Only those lines get
 * mutants, so code a branch moves unchanged, the engine's simulation among it, runs uninstrumented in the dry run and
 * keeps within its tests' timeouts. The diff must name each file with the b/ prefix, unquoted, as mutateDiff.ts asks
 * git for: a file named otherwise throws.
 */
export function mutationTargets(diff: string, untracked: string[]): string[] {
  const targets: string[] = []
  let path: string | undefined
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) path = undefined
    const file = FILE.exec(line)
    if (file) path = file[1]
    // read wrongly, every file would be skipped and the run would say there is nothing to mutate
    else if (line.startsWith('+++ ')) throw new Error(`the diff names a file without the b/ prefix: ${line}`)
    const hunk = HUNK.exec(line)
    if (!hunk || path === undefined || !mutated(path)) continue
    const first = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    if (count > 0) targets.push(`${path}:${first}-${first + count - 1}`)
  }
  return [...targets, ...untracked.filter(mutated)]
}
