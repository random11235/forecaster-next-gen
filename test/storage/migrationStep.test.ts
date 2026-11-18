import { describe, expect, test } from 'vitest'
import { stepNamedBy, stepWriteProblems, topLevelDescribe, versionBefore } from './migrationStep.js'

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

// As Vitest gives a test: its `suite` is the describe it is in, and a describe at the top of its file has none.
describe('the top-level describe a test is in', () => {
  test('is the outermost describe, at the top of the file, whatever is nested under it', () => {
    const step = { name: 'step 5: a data file' }
    const inner = { name: 'a group', suite: step }

    expect(topLevelDescribe({ name: 'keeps it', suite: step })).toBe('step 5: a data file')
    expect(topLevelDescribe({ name: 'keeps it', suite: inner })).toBe('step 5: a data file')
  })

  test('is the outer describe for a step describe nested in another, so the nested one names no step, as for the coverage check', () => {
    const outer = { name: 'a group' }
    const step = { name: 'step 5: a data file', suite: outer }

    expect(topLevelDescribe({ name: 'keeps it', suite: step })).toBe('a group')
  })

  test("is none for a test at the file's top level, or under a describe.each, which the coverage check doesn't read", () => {
    expect(topLevelDescribe({ name: 'step 5: keeps it' })).toBeUndefined()
    expect(topLevelDescribe({ name: 'keeps it', suite: { name: 'step 5: a data file', each: true } })).toBeUndefined()
  })
})

describe("a step test's writes", () => {
  const STEP_5 = 'step 5: a data file from schema version 4'

  test('passes a test under step N writing files at version N - 1, and step 1 writing one at 0', () => {
    expect(stepWriteProblems(STEP_5, [4, 4])).toEqual([])
    expect(stepWriteProblems('step 1: a data file written before schema versions', [0])).toEqual([])
  })

  test('fails a test under step N writing a file at another version, naming the step and the version', () => {
    expect(stepWriteProblems(STEP_5, [4, 3])).toEqual(['a test under `step 5: …` writes a file at version 3: step 5 runs on a file at version 4'])
  })

  test('says step 1 runs on a file from before schema versions, as the coverage check does', () => {
    expect(stepWriteProblems('step 1: a data file', [1])).toEqual([
      'a test under `step 1: …` writes a file at version 1: step 1 runs on a file from before schema versions',
    ])
    expect(stepWriteProblems('step 1: a data file', [])).toEqual([
      'a test under `step 1: …` writes no file: write one from before schema versions, as the release before step 1 left it',
    ])
  })

  test('fails a test under step N writing no file', () => {
    expect(stepWriteProblems(STEP_5, [])).toEqual(['a test under `step 5: …` writes no file: write one at version 4, as the release before step 5 left it'])
  })

  test('takes any writes from a test under no step describe, or none', () => {
    expect(stepWriteProblems('schema version', [])).toEqual([])
    expect(stepWriteProblems('a data file from before the MVP, at the current version', [20])).toEqual([])
    expect(stepWriteProblems(undefined, [3])).toEqual([])
  })
})
