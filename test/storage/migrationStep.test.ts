import { describe, expect, test } from 'vitest'
import { describesAbove, stepNamedBy, stepWriteProblems, versionBefore } from './migrationStep.js'

// The step a migration test's describe names, and the rule migrationsHarness.ts checks its writes by.

describe('the step a title names', () => {
  test.each([
    ['step 5: a data file from schema version 4', 5],
    ['step 12: before the pace window', 12],
    ['a data file from before the MVP', undefined],
    ['before step 5: not a label', undefined],
    ['step five: not a number', undefined],
  ])('%s names %s', (title, step) => {
    expect(stepNamedBy(title)).toBe(step)
  })
})

describe('the version before a step', () => {
  test('is the version before it, and step 1 runs on a file from before schema versions, at 0', () => {
    expect(versionBefore(5)).toEqual({ version: 4, described: 'at version 4' })
    expect(versionBefore(1)).toEqual({ version: 0, described: 'from before schema versions' })
  })
})

describe('the describes above a test', () => {
  test("are its describes' titles, outermost first, its file's first and not its own", () => {
    const file = { name: 'migrations.v1to5.test.ts' }
    const outer = { name: 'a group', suite: file }
    const step = { name: 'step 5: a data file', suite: outer }

    expect(describesAbove({ name: 'step 6: keeps it', suite: step })).toEqual(['migrations.v1to5.test.ts', 'a group', 'step 5: a data file'])
  })
})

describe('the describes above a test, from describe.each', () => {
  test("leave out a describe.each's titles, as the coverage check does", () => {
    const file = { name: 'migrations.v1to5.test.ts' }
    const each = { name: 'step 5: a data file', each: true, suite: file }

    expect(describesAbove({ name: 'keeps it', suite: each })).toEqual(['migrations.v1to5.test.ts'])
  })
})

describe("a step test's writes", () => {
  const STEP_5 = ['migrations.v1to5.test.ts', 'step 5: a data file from schema version 4']

  test('passes a test under step N writing files at version N - 1, and step 1 writing one at 0', () => {
    expect(stepWriteProblems(STEP_5, [4, 4])).toEqual([])
    expect(stepWriteProblems(['step 1: a data file written before schema versions'], [0])).toEqual([])
  })

  test('takes a step named by a describe at any level', () => {
    expect(stepWriteProblems(['migrations.v1to5.test.ts', 'version 4', 'step 5: a data file'], [3])).toEqual([
      'a test under `step 5: …` writes a file at version 3: step 5 runs on a file at version 4',
    ])
  })

  test('fails a test under step N writing a file at another version, naming the step and the version', () => {
    expect(stepWriteProblems(STEP_5, [4, 3])).toEqual(['a test under `step 5: …` writes a file at version 3: step 5 runs on a file at version 4'])
  })

  test('says step 1 runs on a file from before schema versions, as the coverage check does', () => {
    expect(stepWriteProblems(['step 1: a data file'], [1])).toEqual([
      'a test under `step 1: …` writes a file at version 1: step 1 runs on a file from before schema versions',
    ])
    expect(stepWriteProblems(['step 1: a data file'], [])).toEqual([
      'a test under `step 1: …` writes no file: write one from before schema versions, as the release before step 1 left it',
    ])
  })

  test('fails a test under step N writing no file', () => {
    expect(stepWriteProblems(STEP_5, [])).toEqual(['a test under `step 5: …` writes no file: write one at version 4, as the release before step 5 left it'])
  })

  test('fails a test under two steps', () => {
    expect(stepWriteProblems(['step 4: outer', 'step 5: inner'], [4])).toEqual(['a test under `step 4: …` and `step 5: …` names more than one step: name one'])
  })

  test('takes any writes from a test under no step describe', () => {
    expect(stepWriteProblems(['schema version'], [])).toEqual([])
    expect(stepWriteProblems(['a data file from before the MVP, at the current version'], [20])).toEqual([])
  })
})
