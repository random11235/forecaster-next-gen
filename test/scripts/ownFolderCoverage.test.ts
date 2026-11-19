import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { coverageAgainstThresholds, describeDrop, NO_OWN_TEST_FOLDER, OWN_FOLDER_THRESHOLDS } from '../../scripts/ownFolderCoverage.ts'

const full = { statements: 100, branches: 100, functions: 100, lines: 100 }

describe("each module's coverage by its own test folder", () => {
  test('a folder at or above its thresholds is reported, with nothing dropped', () => {
    const { report, drops } = coverageAgainstThresholds(
      { engine: { statements: 97.5, branches: 90, functions: 100, lines: 97.25 } },
      { engine: { statements: 97.42, branches: 90, functions: 100, lines: 97 } },
    )

    expect(drops).toEqual([])
    expect(report).toContain('| `src/engine/` by `test/engine/` | 97.5 (97.42) | 90 (90) | 100 (100) | 97.25 (97) |')
  })

  test('a folder below any of its thresholds, by however little, is a drop of that measure', () => {
    const { report, drops } = coverageAgainstThresholds(
      { forecast: { statements: 91, branches: 84.99, functions: 95, lines: 91 }, storage: full },
      { forecast: { statements: 91, branches: 85, functions: 95, lines: 91 }, storage: full },
    )

    expect(drops).toEqual([{ folder: 'forecast', measure: 'branches', actual: 84.99, threshold: 85 }])
    expect(report).toContain('| `src/forecast/` by `test/forecast/` | 91 (91) | **84.99 (85)** | 95 (95) | 91 (91) |')
    expect(report).toContain('| `src/storage/` by `test/storage/` |')
  })

  test('a folder with thresholds but no figures measured is a drop of each measure', () => {
    const { drops } = coverageAgainstThresholds({}, { secrets: { ...full, branches: 90 } })

    expect(drops).toEqual([
      { folder: 'secrets', measure: 'statements', actual: undefined, threshold: 100 },
      { folder: 'secrets', measure: 'branches', actual: undefined, threshold: 90 },
      { folder: 'secrets', measure: 'functions', actual: undefined, threshold: 100 },
      { folder: 'secrets', measure: 'lines', actual: undefined, threshold: 100 },
    ])
  })

  test('a drop names the folders, the measure and both figures, or that nothing was measured', () => {
    expect(describeDrop({ folder: 'forecast', measure: 'branches', actual: 84.99, threshold: 85 })).toBe(
      '`src/forecast/` by `test/forecast/`: branches 84.99% is below its threshold, 85%',
    )
    expect(describeDrop({ folder: 'secrets', measure: 'lines', actual: undefined, threshold: 100 })).toBe(
      '`src/secrets/` by `test/secrets/`: lines not measured, its threshold 100%',
    )
  })

  test('each folder of src/ has thresholds, or is listed as having no test folder of its own', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const folders = readdirSync(`${root}/src`, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    const listed = [...Object.keys(OWN_FOLDER_THRESHOLDS), ...Object.keys(NO_OWN_TEST_FOLDER)]

    expect(listed.sort()).toEqual(folders.map((entry) => entry.name).sort())
    expect(Object.keys(NO_OWN_TEST_FOLDER).filter((folder) => readdirSync(`${root}/test`).includes(folder))).toEqual([])
  })
})
