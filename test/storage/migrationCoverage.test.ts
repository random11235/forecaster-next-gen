import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MIGRATIONS_FILE, migrationSteps } from '../../scripts/migrationSteps.ts'
import { stepWriteProblems } from './migrationStepLabel.js'

// The migration test rule in docs/design/architecture-test-seams-storage.md: every step of MIGRATIONS has a test that
// opens a data file as it was before that step. A migration test names its step in a top-level
// `describe('step N: …')`. This file checks the names: each step is named by exactly one describe, and none names a
// step MIGRATIONS doesn't have. What a named test arranges is checked as it runs, by migrationsHarness.ts: each test
// under `step N: …` writes a file, and only at version N - 1 (see stepWriteProblems). migrations.beforeTheMvp.test.ts
// names no step on purpose: it writes a file at the current version, so it runs no step.

const root = fileURLToPath(new URL('../..', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))

/** The migration test files, in this folder. */
const MIGRATION_TESTS = 'migrations.*.test.ts'
/** Where they are, as the messages name them. */
const MIGRATION_TESTS_PATH = `test/storage/${MIGRATION_TESTS}`
const MIGRATION_TEST_FILE = new RegExp(`^${MIGRATION_TESTS.replace(/[.]/g, '\\.').replace('*', '.+')}$`)

type TestFile = { file: string; source: string }

/** Each migration test file, with its source. */
function migrationTests(): TestFile[] {
  return readdirSync(here)
    .filter((file) => MIGRATION_TEST_FILE.test(file))
    .map((file) => ({ file, source: readFileSync(`${here}${file}`, 'utf8') }))
}

/**
 * The steps `source` names, each in a `describe('step N: …')` starting its line, in any quotes. A describe in a block
 * comment or after `//` names none.
 */
function stepsNamedIn(source: string): number[] {
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...uncommented.matchAll(/^[ \t]*describe\(\s*(['"`])step (\d+):/gm)].map((match) => Number(match[2]))
}

/**
 * What is wrong with how `tests` name the steps of MIGRATIONS (`steps`, each step's text as migrationSteps gives
 * it), one sentence each: a step no describe names, naming it by its comment; a step named more than once; a step
 * named that MIGRATIONS doesn't have. Each names the files.
 */
function stepNamingProblems(steps: readonly string[], tests: readonly TestFile[]): string[] {
  const filesNaming = new Map<number, string[]>()
  for (const { file, source } of tests) for (const step of stepsNamedIn(source)) filesNaming.set(step, [...(filesNaming.get(step) ?? []), file])

  const untested = steps.flatMap((text, i) => {
    const step = i + 1
    if (filesNaming.has(step)) return []
    const comment = text.split('\n')[0]?.trim()
    const from = step === 1 ? 'from before schema versions' : `at version ${step - 1}`
    return [`step ${step} (\`${comment}\`) has no test: add a describe('step ${step}: …') to a ${MIGRATION_TESTS_PATH} that opens a file ${from}`]
  })
  const misnamed = [...filesNaming].flatMap(([step, files]) => {
    if (step < 1 || step > steps.length) return [`${files.join(', ')} names step ${step}, but MIGRATIONS has steps 1–${steps.length}`]
    if (files.length > 1) return [`step ${step} is named by more than one describe, in ${files.join(', ')}: name it once`]
    return []
  })
  return [...untested, ...misnamed]
}

describe('migration coverage', () => {
  test(`every step of MIGRATIONS in ${MIGRATIONS_FILE} is named once by a migration test, and no other step is`, () => {
    const steps = migrationSteps(readFileSync(`${root}${MIGRATIONS_FILE}`, 'utf8'), MIGRATIONS_FILE)

    expect(stepNamingProblems(steps, migrationTests())).toEqual([])
  })

  const STEPS = ['  // 1: the first schema.\n  `CREATE TABLE a (id TEXT);`,', '  // 2: a second table.\n  `CREATE TABLE b (id TEXT);`,']
  const STEP_1 = { file: 'migrations.a.test.ts', source: "describe('step 1: a data file from before schema versions', () => {})" }

  test('fails on a step no test names, naming it by its comment', () => {
    expect(stepNamingProblems(STEPS, [STEP_1])).toEqual([
      `step 2 (\`// 2: a second table.\`) has no test: add a describe('step 2: …') to a ${MIGRATION_TESTS_PATH} that opens a file at version 1`,
    ])
  })

  test('passes when each step is named once, in any of the files, in any quotes', () => {
    const step2 = { file: 'migrations.b.test.ts', source: 'describe("step 2: a data file from schema version 1", () => {})' }

    expect(stepNamingProblems(STEPS, [STEP_1, step2])).toEqual([])
  })

  test('takes no mention of a step but a describe naming it', () => {
    const mentions = { file: 'migrations.b.test.ts', source: "// step 2: tested later\ntest('step 2: a data file', () => {})" }

    expect(stepNamingProblems(STEPS, [STEP_1, mentions])).toEqual([expect.stringMatching(/^step 2 .* has no test/)])
  })

  test.each([
    ['a line comment', "// describe('step 2: a data file from schema version 1', () => {})"],
    ['a block comment', "/* describe('step 2: a data file from schema version 1', () => {}) */"],
    ['a block comment over lines', "/*\ndescribe('step 2: a data file from schema version 1', () => {})\n*/"],
  ])('takes no describe in %s', (_, source) => {
    expect(stepNamingProblems(STEPS, [STEP_1, { file: 'migrations.b.test.ts', source }])).toEqual([expect.stringMatching(/^step 2 .* has no test/)])
  })

  test('fails on a step named twice, naming both files', () => {
    const twice = { file: 'migrations.b.test.ts', source: "describe('step 1: again', () => {})\ndescribe('step 2: a data file', () => {})" }

    expect(stepNamingProblems(STEPS, [STEP_1, twice])).toEqual([
      'step 1 is named by more than one describe, in migrations.a.test.ts, migrations.b.test.ts: name it once',
    ])
  })

  test('fails on a step MIGRATIONS does not have, naming the file', () => {
    const stale = { file: 'migrations.b.test.ts', source: "describe('step 2: a data file', () => {})\ndescribe('step 3: from the future', () => {})" }

    expect(stepNamingProblems(STEPS, [STEP_1, stale])).toEqual(['migrations.b.test.ts names step 3, but MIGRATIONS has steps 1–2'])
  })
})

describe("a step test's writes, as migrationsHarness.ts checks them", () => {
  test('passes a test under step N writing files at version N - 1, and step 1 writing one at 0', () => {
    expect(stepWriteProblems('step 5: a data file from schema version 4 > keeps it', [4, 4])).toEqual([])
    expect(stepWriteProblems('step 1: a data file written before schema versions > opens', [0])).toEqual([])
  })

  test('fails a test under step N writing a file at another version, naming the step and the version', () => {
    expect(stepWriteProblems('step 5: a data file from schema version 4 > keeps it', [4, 3])).toEqual([
      'a test under `step 5: …` writes a file at version 3: step 5 runs on a file at version 4',
    ])
  })

  test('fails a test under step N writing no file', () => {
    expect(stepWriteProblems('step 5: a data file from schema version 4 > keeps it', [])).toEqual([
      'a test under `step 5: …` writes no file: write one at version 4, as the release before step 5 left it',
    ])
  })

  test('takes any writes from a test under no step', () => {
    expect(stepWriteProblems('schema version > a fresh file', [])).toEqual([])
    expect(stepWriteProblems('a data file from before the MVP, at the current version > keeps it', [20])).toEqual([])
    expect(stepWriteProblems(undefined, [3])).toEqual([])
  })
})
