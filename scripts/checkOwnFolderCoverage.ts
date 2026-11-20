// Checks each module's coverage by its own test folder (scripts/ownFolderCoverage.ts): runs `test/<folder>/` alone
// with coverage over `src/<folder>/` alone, for each folder with thresholds, then prints the report as Markdown, for
// CI's job summary. Exits 1, the report saying why, when a folder drops below a threshold or its coverage isn't measured
// (its tests failed). Vitest's own output, and the report again on a drop, go to stderr.
// Run with `npm run coverage:folders`; each folder's JSON summary lands in coverage-folders/<folder>/.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Coverage, coverageAgainstThresholds, coverageFromSummary, MEASURES, OWN_FOLDER_THRESHOLDS } from './ownFolderCoverage.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

const measured: Record<string, Coverage> = {}
for (const folder of Object.keys(OWN_FOLDER_THRESHOLDS)) {
  const reports = join(root, 'coverage-folders', folder)
  // `test:coverage` as CI's checks run it, leaving out what they leave out (the benchmark)
  const run = spawnSync(
    'npm',
    [
      'run',
      '--silent',
      'test:coverage',
      '--',
      `test/${folder}/`,
      `--coverage.include=src/${folder}/**`,
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${reports}`,
      // the whole suite's thresholds (vitest.config.ts) don't apply to one folder's tests
      ...MEASURES.map((measure) => `--coverage.thresholds.${measure}=0`),
    ],
    { cwd: root, stdio: ['ignore', process.stderr, process.stderr] },
  )
  if (run.status === 0) measured[folder] = coverageFromSummary(readFileSync(join(reports, 'coverage-summary.json'), 'utf8'))
}

const { report, drops } = coverageAgainstThresholds(measured)
console.log(report)
if (drops.length > 0) {
  console.error(report)
  process.exitCode = 1
}
