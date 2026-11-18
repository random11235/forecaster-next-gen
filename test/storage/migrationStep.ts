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

/** A test or describe, as Vitest gives it: its title, whether a `.each` made it, and the describe or file it is in. */
type Task = { name: string; each?: boolean; suite?: Task }

/**
 * The titles of the plain describes `task` is in, outermost first, its file's first: not its own, so a test's title
 * names no step, and not a `describe.each`'s, which the coverage check doesn't read either.
 */
export function describesAbove(task: Task): string[] {
  const titles: string[] = []
  for (let suite = task.suite; suite !== undefined; suite = suite.suite) if (suite.each !== true) titles.unshift(suite.name)
  return titles
}

/**
 * What is wrong with the versions of the data files a test wrote, one sentence each, from `describes`, the titles of
 * the describes it is in (describesAbove): a test under a `step N: …` describe writes at least one file, and each as
 * versionBefore(N) says, and is under one step only. A test under no step may write any.
 */
export function stepWriteProblems(describes: readonly string[], versions: readonly number[]): string[] {
  const steps = [...new Set(describes.flatMap((title) => stepNamedBy(title) ?? []))]
  if (steps.length > 1) return [`a test under ${steps.map((step) => `\`step ${step}: …\``).join(' and ')} names more than one step: name one`]
  const [step] = steps
  if (step === undefined) return []
  const before = versionBefore(step)
  if (versions.length === 0)
    return [`a test under \`step ${step}: …\` writes no file: write one ${before.described}, as the release before step ${step} left it`]
  return [...new Set(versions)]
    .filter((version) => version !== before.version)
    .map((version) => `a test under \`step ${step}: …\` writes a file at version ${version}: step ${step} runs on a file ${before.described}`)
}
