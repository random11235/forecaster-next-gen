import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { coverageAgainstThresholds, coverageFromSummary, NO_OWN_TEST_FOLDER, OWN_FOLDER_THRESHOLDS } from '../../scripts/ownFolderCoverage.ts'

const full = { statements: 100, branches: 100, functions: 100, lines: 100 }

describe("each module's coverage by its own test folder", () => {
  test("a folder's figures are the totals of Vitest's coverage summary", () => {
    const measure = (pct: number) => ({ total: 10, covered: 9, skipped: 0, pct })
    const summary = JSON.stringify({
      total: { lines: measure(93.48), statements: measure(92.79), functions: measure(94.65), branches: measure(84.11), branchesTrue: { pct: 'Unknown' } },
      '/repo/src/app/launch.ts': { lines: measure(50), statements: measure(50), functions: measure(50), branches: measure(50) },
    })

    expect(coverageFromSummary(summary)).toEqual({ statements: 92.79, branches: 84.11, functions: 94.65, lines: 93.48 })
  })

  test('a folder at or above its thresholds is reported, with nothing dropped', () => {
    const { report, drops } = coverageAgainstThresholds(
      { engine: { statements: 97.5, branches: 90, functions: 100, lines: 97.25 } },
      { engine: { statements: 97.42, branches: 90, functions: 100, lines: 97 } },
    )

    expect(drops).toEqual([])
    expect(report).toContain('| `src/engine/` by `test/engine/` | 97.5 (97.42) | 90 (90) | 100 (100) | 97.25 (97) |')
    expect(report).not.toContain('below its threshold')
  })

  test('a folder below any of its thresholds, by however little, is a drop of that measure, listed under the report', () => {
    const { report, drops } = coverageAgainstThresholds(
      { forecast: { statements: 91, branches: 84.99, functions: 95, lines: 91 }, storage: full },
      { forecast: { statements: 91, branches: 85, functions: 95, lines: 91 }, storage: full },
    )

    expect(drops).toEqual([{ kind: 'below', folder: 'forecast', measure: 'branches', actual: 84.99, threshold: 85 }])
    expect(report).toContain('| `src/forecast/` by `test/forecast/` | 91 (91) | **84.99 (85)** | 95 (95) | 91 (91) |')
    expect(report).toContain('| `src/storage/` by `test/storage/` |')
    expect(report).toContain('- `src/forecast/` by `test/forecast/`: branches 84.99% is below its threshold, 85%')
  })

  test('a folder with thresholds but no figures measured is one drop, said once in its row and once under the report', () => {
    const { report, drops } = coverageAgainstThresholds({}, { secrets: full })

    expect(drops).toEqual([{ kind: 'not measured', folder: 'secrets' }])
    expect(report).toContain('| `src/secrets/` by `test/secrets/` | **no coverage was measured** | | | |')
    expect(report).toContain('- `src/secrets/` by `test/secrets/`: no coverage was measured')
  })

  test('each folder of src/ has thresholds, or is listed as having no test folder of its own', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const folders = readdirSync(`${root}/src`, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    const listed = [...Object.keys(OWN_FOLDER_THRESHOLDS), ...Object.keys(NO_OWN_TEST_FOLDER)]

    expect(listed.sort()).toEqual(folders.map((entry) => entry.name).sort())
    expect(Object.keys(NO_OWN_TEST_FOLDER).filter((folder) => readdirSync(`${root}/test`).includes(folder))).toEqual([])
  })
})
