// A migration test names the step of MIGRATIONS it runs in its top-level `describe('step N: …')`, and arranges a data
// file as the release before that step left it, at version N - 1. migrationsHarness.ts checks each test's writes by
// this as it runs; migrationCoverage.test.ts checks the names.

/** The step `testName` (Vitest's, its describes and its own title joined by ` > `) is under, if its describe names one. */
function stepOf(testName: string | undefined): number | undefined {
  const step = /^step (\d+):/.exec(testName ?? '')?.[1]
  return step === undefined ? undefined : Number(step)
}

/**
 * What is wrong with the versions of the data files a test named `testName` wrote, one sentence each: a test under
 * `step N: …` writes at least one file, and each at version N - 1. A test under no step may write any.
 */
export function stepWriteProblems(testName: string | undefined, versions: readonly number[]): string[] {
  const step = stepOf(testName)
  if (step === undefined) return []
  if (versions.length === 0)
    return [`a test under \`step ${step}: …\` writes no file: write one at version ${step - 1}, as the release before step ${step} left it`]
  return [...new Set(versions)]
    .filter((version) => version !== step - 1)
    .map((version) => `a test under \`step ${step}: …\` writes a file at version ${version}: step ${step} runs on a file at version ${step - 1}`)
}
