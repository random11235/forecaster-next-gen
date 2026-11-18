// A migration test names the step of MIGRATIONS it runs in a top-level `describe('step N: …')`, one whose parent is
// its file, so it always registers, and arranges a data file as the release before that step left it (versionBefore). migrationsHarness.ts checks each test's writes by
// this as it runs; migrationCoverage.test.ts checks the names, both through stepNamedBy.

/** The step `title`, a describe's or a test's, names: `step N: …`. */
export function stepNamedBy(title: string): number | undefined {
  const step = /^step (\d+):/.exec(title)?.[1]
  return step === undefined ? undefined : Number(step)
}

/** The version of the data file step `step` runs on, and how a message says so: step 1 runs on one from before schema versions. */
export function versionBefore(step: number): { version: number; described: string } {
  return step === 1 ? { version: 0, described: 'from before schema versions' } : { version: step - 1, described: `at version ${step - 1}` }
}

/** A test or describe, as Vitest gives it: its title, whether a `.each` made it, and the describe it is in, none at the top of its file. */
type Task = { name: string; each?: boolean; suite?: Task }

/**
 * The title of the top-level describe `task` is in, the outermost, whose parent is its file, if any: a nested describe
 * names no step, and neither does a top-level `describe.each`, which the coverage check doesn't read either.
 */
export function topLevelDescribe(task: Task): string | undefined {
  let suite = task.suite
  if (suite === undefined) return undefined
  while (suite.suite !== undefined) suite = suite.suite
  return suite.each === true ? undefined : suite.name
}

/**
 * What is wrong with the versions of the data files a test wrote, one sentence each, from `describe`, the title of its
 * top-level describe (topLevelDescribe): a test under a `step N: …` describe writes at least one file, and each as
 * versionBefore(N) says. A test under no step may write any.
 */
export function stepWriteProblems(describe: string | undefined, versions: readonly number[]): string[] {
  const step = describe === undefined ? undefined : stepNamedBy(describe)
  if (step === undefined) return []
  const before = versionBefore(step)
  if (versions.length === 0)
    return [`a test under \`step ${step}: …\` writes no file: write one ${before.described}, as the release before step ${step} left it`]
  return [...new Set(versions)]
    .filter((version) => version !== before.version)
    .map((version) => `a test under \`step ${step}: …\` writes a file at version ${version}: step ${step} runs on a file ${before.described}`)
}
