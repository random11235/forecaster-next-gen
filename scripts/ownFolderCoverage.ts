// Each module's coverage by its own test folder: `test/<folder>/` run alone over `src/<folder>/`, so behaviour tested
// only at an outer layer shows as a drop. scripts/checkOwnFolderCoverage.ts measures it; CI runs that and fails on a drop.

/** The measures of coverage, as Vitest's coverage summary and its `--coverage.thresholds.*` flags name them. */
export const MEASURES = ['statements', 'branches', 'functions', 'lines'] as const
export type Measure = (typeof MEASURES)[number]

/** A folder's coverage, in percent, as Vitest's coverage summary gives it. */
export type Coverage = Record<Measure, number>

/**
 * Each folder of `src/` that `test/` has a folder for, and the coverage its own tests may not drop below: the figures
 * as #262 measured them, so any drop fails. Raise one when its tests cover more.
 */
export const OWN_FOLDER_THRESHOLDS: Record<string, Coverage> = {
  engine: { statements: 99.63, branches: 97.45, functions: 100, lines: 100 },
  forecast: { statements: 97.86, branches: 93.94, functions: 100, lines: 99.68 },
  connectors: { statements: 94.88, branches: 87.54, functions: 96.26, lines: 99.42 },
  storage: { statements: 99.16, branches: 96.53, functions: 99.3, lines: 99.32 },
  secrets: { statements: 100, branches: 100, functions: 100, lines: 100 },
  app: { statements: 92.79, branches: 84.11, functions: 94.65, lines: 93.48 },
}

/**
 * Each folder of `src/` with no test folder of its own, and why. One that gains logic needs a test folder, and
 * thresholds above, instead.
 */
export const NO_OWN_TEST_FOLDER: Record<string, string> = {
  model: 'types only: nothing in it runs, so there is nothing to cover',
}

/** A measure of a folder below its threshold; `actual` is undefined when nothing was measured, as when its tests failed. */
export interface Drop {
  folder: string
  measure: Measure
  actual: number | undefined
  threshold: number
}

/** A folder and its own test folder, as the report and each drop name them. */
const byOwnTests = (folder: string) => `\`src/${folder}/\` by \`test/${folder}/\``

export function describeDrop({ folder, measure, actual, threshold }: Drop): string {
  return actual === undefined
    ? `${byOwnTests(folder)}: ${measure} not measured, its threshold ${threshold}%`
    : `${byOwnTests(folder)}: ${measure} ${actual}% is below its threshold, ${threshold}%`
}

/**
 * Judges each folder's figures against its thresholds: the CI summary's report, in Markdown, and each drop, a measure
 * below its threshold or not measured.
 */
export function coverageAgainstThresholds(
  measured: Record<string, Coverage>,
  thresholds: Record<string, Coverage> = OWN_FOLDER_THRESHOLDS,
): { report: string; drops: Drop[] } {
  const drops: Drop[] = []
  const rows = Object.entries(thresholds).map(([folder, threshold]) => {
    const cells = MEASURES.map((measure) => {
      const actual = measured[folder]?.[measure]
      const cell = `${actual ?? 'not measured'} (${threshold[measure]})`
      if (actual !== undefined && actual >= threshold[measure]) return cell
      drops.push({ folder, measure, actual, threshold: threshold[measure] })
      return `**${cell}**`
    })
    return `| ${byOwnTests(folder)} | ${cells.join(' | ')} |`
  })
  const report = [
    "Each module's coverage by its own test folder alone, in percent, its threshold in brackets; one in bold has dropped below it.",
    '',
    '| Module | Statements | Branches | Functions | Lines |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
  return { report, drops }
}
