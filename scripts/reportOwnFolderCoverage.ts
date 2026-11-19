// Measures each module's coverage by its own test folder (scripts/ownFolderCoverage.ts): runs `test/<folder>/` alone
// with coverage over `src/<folder>/` alone, for each folder with thresholds, then prints the report as Markdown, for
// CI's job summary. Exits 1, naming each, when a folder drops below a threshold. Vitest's own output goes to stderr.
// Run with `npm run coverage:folders`; each folder's JSON summary lands in coverage-folders/<folder>/.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Coverage, OWN_FOLDER_THRESHOLDS, ownFolderCoverage } from './ownFolderCoverage.ts'

const root = fileURLToPath(new URL('..', import.meta.url))

const measured: Record<string, Coverage> = {}
for (const folder of Object.keys(OWN_FOLDER_THRESHOLDS)) {
  const reports = join(root, 'coverage-folders', folder)
  const run = spawnSync(
    'npx',
    [
      'vitest',
      'run',
      `test/${folder}/`,
      // timed apart from coverage in CI, and slowed several times over by it
      '--exclude',
      'test/engine/benchmark.test.ts',
      '--coverage',
      `--coverage.include=src/${folder}/**`,
      '--coverage.reporter=json-summary',
      `--coverage.reportsDirectory=${reports}`,
      // the whole suite's thresholds (vitest.config.ts) don't apply to one folder's tests
      ...['statements', 'branches', 'functions', 'lines'].map((measure) => `--coverage.thresholds.${measure}=0`),
    ],
    { cwd: root, stdio: ['ignore', process.stderr, process.stderr] },
  )
  if (run.status !== 0) {
    console.error(`test/${folder}/ failed, so its coverage isn't measured`)
    continue
  }
  const { total } = JSON.parse(readFileSync(join(reports, 'coverage-summary.json'), 'utf8')) as {
    total: Record<keyof Coverage, { pct: number }>
  }
  measured[folder] = {
    statements: total.statements.pct,
    branches: total.branches.pct,
    functions: total.functions.pct,
    lines: total.lines.pct,
  }
}

const { report, drops } = ownFolderCoverage(measured)
console.log(report)
for (const drop of drops) console.error(drop)
process.exitCode = drops.length > 0 ? 1 : 0
