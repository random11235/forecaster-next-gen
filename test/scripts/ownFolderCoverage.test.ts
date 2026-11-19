import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { OWN_FOLDER_THRESHOLDS, ownFolderCoverage } from '../../scripts/ownFolderCoverage.ts'

const full = { statements: 100, branches: 100, functions: 100, lines: 100 }

describe("each module's coverage by its own test folder", () => {
  test('a folder at or above its thresholds is reported, with nothing dropped', () => {
    const { report, drops } = ownFolderCoverage(
      { engine: { statements: 97.5, branches: 90, functions: 100, lines: 97.25 } },
      { engine: { statements: 97, branches: 90, functions: 100, lines: 97 } },
    )

    expect(drops).toEqual([])
    expect(report).toContain('| `src/engine/` by `test/engine/` | 97.5 (97) | 90 (90) | 100 (100) | 97.25 (97) |')
  })

  test('a folder below any of its thresholds is a drop, naming the folder, the measure and both figures', () => {
    const { report, drops } = ownFolderCoverage(
      { forecast: { statements: 91, branches: 84.9, functions: 95, lines: 91 }, storage: full },
      { forecast: { statements: 91, branches: 85, functions: 95, lines: 91 }, storage: full },
    )

    expect(drops).toEqual(['src/forecast/ by test/forecast/: branches 84.9% is below its threshold, 85%'])
    expect(report).toContain('| `src/forecast/` by `test/forecast/` | 91 (91) | **84.9 (85)** | 95 (95) | 91 (91) |')
    expect(report).toContain('| `src/storage/` by `test/storage/` |')
  })

  test('a folder with a threshold but no figure measured is a drop', () => {
    const { drops } = ownFolderCoverage({}, { secrets: full })

    expect(drops).toEqual(['src/secrets/ by test/secrets/: no coverage was measured'])
  })

  test('each folder of src/ that test/ has a folder for has thresholds', () => {
    const root = fileURLToPath(new URL('../..', import.meta.url))
    const tested = readdirSync(`${root}/src`, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(`${root}/test/${entry.name}`))
      .map((entry) => entry.name)

    expect(Object.keys(OWN_FOLDER_THRESHOLDS).sort()).toEqual(tested.sort())
  })
})
