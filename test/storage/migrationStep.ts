// A migration test names the step of MIGRATIONS it runs in a `describe('step N: …')`, at any level, and arranges a
// data file as the release before that step left it (versionBefore). migrationsHarness.ts checks each test's writes by
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

/**
 * What is wrong with the versions of the data files a test wrote, one sentence each, from `titles`, its file's, its
 * describes' and its own: a test under a `step N: …` describe writes at least one file, and each at versionBefore(N),
 * and is under one step only. A test under no step may write any.
 */
export function stepWriteProblems(titles: readonly string[], versions: readonly number[]): string[] {
  const steps = [...new Set(titles.flatMap((title) => stepNamedBy(title) ?? []))]
  if (steps.length > 1) return [`a test under ${steps.map((step) => `\`step ${step}: …\``).join(' and ')} names more than one step: name one`]
  const [step] = steps
  if (step === undefined) return []
  const before = versionBefore(step).version
  if (versions.length === 0)
    return [`a test under \`step ${step}: …\` writes no file: write one at version ${before}, as the release before step ${step} left it`]
  return [...new Set(versions)]
    .filter((version) => version !== before)
    .map((version) => `a test under \`step ${step}: …\` writes a file at version ${version}: step ${step} runs on a file at version ${before}`)
}
