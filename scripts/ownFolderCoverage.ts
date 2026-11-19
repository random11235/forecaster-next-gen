// Each module's coverage by its own test folder: `test/<folder>/` run alone over `src/<folder>/`, so behaviour tested
// only at an outer layer shows as a drop. scripts/reportOwnFolderCoverage.ts measures it; CI runs that and fails on a drop.

/** A folder's coverage, in percent, as Vitest's coverage summary gives it. */
export interface Coverage {
  statements: number
  branches: number
  functions: number
  lines: number
}

const MEASURES = ['statements', 'branches', 'functions', 'lines'] as const

/**
 * Each folder of `src/` that `test/` has a folder for, and the coverage its own tests may not drop below: the figures
 * when #262 measured them, rounded down to the whole percent. Raise one when its tests cover more.
 */
export const OWN_FOLDER_THRESHOLDS: Record<string, Coverage> = {
  engine: { statements: 99, branches: 97, functions: 100, lines: 100 },
  forecast: { statements: 97, branches: 93, functions: 100, lines: 99 },
  connectors: { statements: 94, branches: 87, functions: 96, lines: 99 },
  storage: { statements: 99, branches: 96, functions: 99, lines: 99 },
  secrets: { statements: 100, branches: 100, functions: 100, lines: 100 },
  app: { statements: 92, branches: 84, functions: 94, lines: 93 },
}

const named = (folder: string) => `src/${folder}/ by test/${folder}/`

/**
 * The CI summary's report of each folder's coverage, measured against its thresholds, in Markdown, and each drop: a
 * measure below its threshold, or a folder with thresholds and nothing measured.
 */
export function ownFolderCoverage(
  measured: Record<string, Coverage>,
  thresholds: Record<string, Coverage> = OWN_FOLDER_THRESHOLDS,
): { report: string; drops: string[] } {
  const drops: string[] = []
  const rows = Object.entries(thresholds).map(([folder, threshold]) => {
    const coverage = measured[folder]
    if (coverage === undefined) {
      drops.push(`${named(folder)}: no coverage was measured`)
      return `| \`src/${folder}/\` by \`test/${folder}/\` | ${MEASURES.map(() => 'not measured').join(' | ')} |`
    }
    const cells = MEASURES.map((measure) => {
      const cell = `${coverage[measure]} (${threshold[measure]})`
      if (coverage[measure] >= threshold[measure]) return cell
      drops.push(`${named(folder)}: ${measure} ${coverage[measure]}% is below its threshold, ${threshold[measure]}%`)
      return `**${cell}**`
    })
    return `| \`src/${folder}/\` by \`test/${folder}/\` | ${cells.join(' | ')} |`
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
