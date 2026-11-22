// Each module's coverage by its own test folder: `test/<folder>/` run alone over `src/<folder>/`, so behaviour tested
// only at an outer layer shows as a drop. scripts/checkOwnFolderCoverage.ts measures it; CI runs that and fails on a drop.

/** The measures of coverage, as Vitest's coverage summary and its `--coverage.thresholds.*` flags name them. */
export const MEASURES = ['statements', 'branches', 'functions', 'lines'] as const
type Measure = (typeof MEASURES)[number]

/** A folder's coverage, in percent, as Vitest's coverage summary gives it. */
export type Coverage = Record<Measure, number>

/**
 * Each folder of `src/` that `test/` has a folder for, and the coverage its own tests may not drop below: the figures
 * as last measured, so any drop fails. Raise one when its tests cover more. `engine`, `connectors`, `storage` and
 * `secrets` are as #262 measured them; `forecast` as #228 measured it, with `test/forecast/` testing forecast/
 * through its handle alone; `app` as #236 measured it, with its screens' component tests.
 */
export const OWN_FOLDER_THRESHOLDS: Record<string, Coverage> = {
  engine: { statements: 99.63, branches: 97.45, functions: 100, lines: 100 },
  forecast: { statements: 97.99, branches: 94.8, functions: 100, lines: 99.7 },
  connectors: { statements: 94.88, branches: 87.54, functions: 96.26, lines: 99.42 },
  storage: { statements: 99.16, branches: 96.53, functions: 99.3, lines: 99.32 },
  secrets: { statements: 100, branches: 100, functions: 100, lines: 100 },
  app: { statements: 95.29, branches: 89.33, functions: 97.82, lines: 94.89 },
}

/**
 * Each folder of `src/` with no test folder of its own, and why. One that gains logic needs a test folder, and
 * thresholds above, instead.
 */
export const NO_OWN_TEST_FOLDER: Record<string, string> = {
  model: 'types and constants (AMBIGUITIES, DAY_MS, …) only: no logic of its own to cover',
  ledger: 'types only: the Ledger interface, which storage keeps, and its logged forecasts: no logic of its own to cover',
}

/** A folder's figures: the totals of Vitest's `json-summary` coverage report (`coverage-summary.json`), as read. */
export function coverageFromSummary(summary: string): Coverage {
  const { total } = JSON.parse(summary) as { total: Record<Measure, { pct: number }> }
  // Object.fromEntries can't know its keys are each measure once, so the cast says so
  return Object.fromEntries(MEASURES.map((measure) => [measure, total[measure].pct])) as Coverage
}

/** A measure of a folder below its threshold, or a folder with nothing measured, as when its tests failed. */
type Drop = { kind: 'below'; folder: string; measure: Measure; actual: number; threshold: number } | { kind: 'not measured'; folder: string }

const NOT_MEASURED = 'no coverage was measured'

/** A folder and its own test folder, as the report's rows and drops name them. */
const byOwnTests = (folder: string) => `\`src/${folder}/\` by \`test/${folder}/\``

const describeDrop = (drop: Drop) =>
  drop.kind === 'not measured'
    ? `${byOwnTests(drop.folder)}: ${NOT_MEASURED}`
    : `${byOwnTests(drop.folder)}: ${drop.measure} ${drop.actual}% is below its threshold, ${drop.threshold}%`

/**
 * Judges each folder's figures against its thresholds: each drop, and the CI summary's report, in Markdown, with each
 * drop said under its table.
 */
export function coverageAgainstThresholds(
  measured: Record<string, Coverage>,
  thresholds: Record<string, Coverage> = OWN_FOLDER_THRESHOLDS,
): { report: string; drops: Drop[] } {
  const drops: Drop[] = []
  const rows = Object.entries(thresholds).map(([folder, threshold]) => {
    const coverage = measured[folder]
    if (coverage === undefined) {
      drops.push({ kind: 'not measured', folder })
      return `| ${byOwnTests(folder)} | **${NOT_MEASURED}** | | | |`
    }
    const cells = MEASURES.map((measure) => {
      const cell = `${coverage[measure]} (${threshold[measure]})`
      if (coverage[measure] >= threshold[measure]) return cell
      drops.push({ kind: 'below', folder, measure, actual: coverage[measure], threshold: threshold[measure] })
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
    ...(drops.length > 0 ? ['', 'Dropped:', '', ...drops.map((drop) => `- ${describeDrop(drop)}`)] : []),
  ].join('\n')
  return { report, drops }
}
