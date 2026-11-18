import { readdirSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MIGRATIONS_FILE, migrationSteps } from '../../scripts/migrationSteps.ts'
import { stepNamedBy, versionBefore } from './migrationStep.js'

// The Migration tests section of docs/design/architecture-test-seams-storage.md: every step of MIGRATIONS has a test
// that opens a data file as it was before that step, named in a `describe('step N: …')` (migrationStep.ts). This file
// checks the names: each step is named by exactly one describe, none names a step MIGRATIONS doesn't have, and a file
// naming one arranges through migrationsHarness.ts, which checks what each test under a step's describe writes as it
// runs, and skips no test, so each step's describe holds a test that runs (Vitest fails one holding none).
// migrations.beforeTheMvp.test.ts names no step on purpose: it writes a file at the current version, so it runs none.

const root = fileURLToPath(new URL('../..', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))

/** The migration test files, in this folder: as the messages name them, and as a file name is matched. */
const MIGRATION_TESTS = { path: `${relative(root, here)}/migrations.*.test.ts`, file: /^migrations\..+\.test\.ts$/ }

type TestFile = { file: string; source: string }

/** Each migration test file, with its source. */
function migrationTests(): TestFile[] {
  return readdirSync(here)
    .filter((file) => MIGRATION_TESTS.file.test(file))
    .map((file) => ({ file, source: readFileSync(`${here}${file}`, 'utf8') }))
}

/**
 * The steps `source` names, each in a `describe('step N: …')` starting its line, at any level, in any quotes. A
 * describe in a block comment or after `//` names none.
 */
function stepsNamedIn(source: string): number[] {
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...uncommented.matchAll(/^[ \t]*describe\(\s*(['"`])(.*?)\1/gm)].flatMap((match) => stepNamedBy(match[2] ?? '') ?? [])
}

/**
 * Whether `source` imports migrationsHarness.ts, which checks what each step's test writes: its bindings, wrapped over
 * lines or not, or the bare module. A type-only import runs none of it.
 */
const usesHarness = (source: string): boolean => /^import\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?'\.\/migrationsHarness\.js'/m.test(source)

/**
 * Whether `source` skips, todos or singles out a test or describe, so a step's describe may hold no test that runs:
 * Vitest itself fails a describe holding no test at all.
 */
const runsSometimes = (source: string): boolean => /\b(?:describe|test|it)\.(?:skip|todo|only|skipIf|runIf)\b/.test(source.replace(/\/\*[\s\S]*?\*\//g, ''))

/**
 * What is wrong with how `tests` name the steps of MIGRATIONS (`steps`, each step's text as migrationSteps gives
 * it), one sentence each: a step no describe names, naming it by its comment; a step named more than once; a step
 * named that MIGRATIONS doesn't have; a file naming a step that doesn't arrange through the harness, or that skips, todos
 * or singles out a test. Each names the files.
 */
function stepNamingProblems(steps: readonly string[], tests: readonly TestFile[]): string[] {
  const filesNaming = new Map<number, string[]>()
  for (const { file, source } of tests) for (const step of stepsNamedIn(source)) filesNaming.set(step, [...(filesNaming.get(step) ?? []), file])

  const untested = steps.flatMap((text, i) => {
    const step = i + 1
    if (filesNaming.has(step)) return []
    const comment = text.split('\n')[0]?.trim()
    return [
      `step ${step} (\`${comment}\`) has no test: add a describe('step ${step}: …') to a ${MIGRATION_TESTS.path} that opens a file ${versionBefore(step).described}`,
    ]
  })
  const misnamed = [...filesNaming].flatMap(([step, files]) => {
    const named = [...new Set(files)].join(', ')
    if (step < 1 || step > steps.length) return [`${named} names step ${step}, but MIGRATIONS has steps 1–${steps.length}`]
    if (files.length > 1) return [`step ${step} is named by more than one describe, in ${named}: name it once`]
    return []
  })
  const unchecked = tests
    .filter(({ source }) => stepsNamedIn(source).length > 0 && !usesHarness(source))
    .map(({ file }) => `${file} names a step but doesn't import migrationsHarness.ts, which checks what each step's test writes`)
  const sometimes = tests
    .filter(({ source }) => stepsNamedIn(source).length > 0 && runsSometimes(source))
    .map(({ file }) => `${file} names a step and skips, todos or singles out a test: every test in a file naming a step runs, so each step has a test that ran`)
  return [...untested, ...misnamed, ...unchecked, ...sometimes]
}

describe('migration coverage', () => {
  test(`every step of MIGRATIONS in ${MIGRATIONS_FILE} is named once by a migration test, and no other step is`, () => {
    const steps = migrationSteps(readFileSync(`${root}${MIGRATIONS_FILE}`, 'utf8'), MIGRATIONS_FILE)

    expect(stepNamingProblems(steps, migrationTests())).toEqual([])
  })

  test.each([
    ['migrations.v1to5.test.ts', true],
    ['migrations.beforeTheMvp.test.ts', true],
    ['migrationCoverage.test.ts', false],
    ['migrationsHarness.ts', false],
    ['migrations.test.ts', false],
  ])('takes %s as a migration test: %s', (file, taken) => {
    expect(MIGRATION_TESTS.file.test(file)).toBe(taken)
  })

  const HARNESS = "import { open, writeFile } from './migrationsHarness.js'\n"
  const STEPS = ['  // 1: the first schema.\n  `CREATE TABLE a (id TEXT);`,', '  // 2: a second table.\n  `CREATE TABLE b (id TEXT);`,']
  const STEP_1 = { file: 'migrations.a.test.ts', source: `${HARNESS}describe('step 1: a data file from before schema versions', () => {})` }
  const UNTESTED_STEP_2 = expect.stringMatching(/^step 2 .* has no test/)

  test('fails on a step no test names, naming it by its comment', () => {
    expect(stepNamingProblems(STEPS, [STEP_1])).toEqual([
      `step 2 (\`// 2: a second table.\`) has no test: add a describe('step 2: …') to a test/storage/migrations.*.test.ts that opens a file at version 1`,
    ])
  })

  test('passes when each step is named once, in any of the files, in any quotes, at any level', () => {
    const step2 = { file: 'migrations.b.test.ts', source: `${HARNESS}describe('a group', () => {\n  describe("step 2: a data file", () => {})\n})` }

    expect(stepNamingProblems(STEPS, [STEP_1, step2])).toEqual([])
  })

  test('takes no mention of a step but a describe naming it', () => {
    const mentions = { file: 'migrations.b.test.ts', source: `${HARNESS}// step 2: tested later\ntest('step 2: a data file', () => {})` }

    expect(stepNamingProblems(STEPS, [STEP_1, mentions])).toEqual([UNTESTED_STEP_2])
  })

  test.each([
    ['a line comment', "// describe('step 2: a data file from schema version 1', () => {})"],
    ['a block comment', "/* describe('step 2: a data file from schema version 1', () => {}) */"],
    ['a block comment over lines', "/*\ndescribe('step 2: a data file from schema version 1', () => {})\n*/"],
  ])('takes no describe in %s', (_, source) => {
    expect(stepNamingProblems(STEPS, [STEP_1, { file: 'migrations.b.test.ts', source: `${HARNESS}${source}` }])).toEqual([UNTESTED_STEP_2])
  })

  test('fails on a step named twice, naming both files', () => {
    const twice = { file: 'migrations.b.test.ts', source: `${HARNESS}describe('step 1: again', () => {})\ndescribe('step 2: a data file', () => {})` }

    expect(stepNamingProblems(STEPS, [STEP_1, twice])).toEqual([
      'step 1 is named by more than one describe, in migrations.a.test.ts, migrations.b.test.ts: name it once',
    ])
  })

  test('fails on a step named twice in one file, naming it once', () => {
    const twice = { file: 'migrations.a.test.ts', source: `${HARNESS}describe('step 1: a data file', () => {})\ndescribe('step 1: again', () => {})` }
    const step2 = { file: 'migrations.b.test.ts', source: `${HARNESS}describe('step 2: a data file', () => {})` }

    expect(stepNamingProblems(STEPS, [twice, step2])).toEqual(['step 1 is named by more than one describe, in migrations.a.test.ts: name it once'])
  })

  test('fails on a step MIGRATIONS does not have, naming the file', () => {
    const stale = { file: 'migrations.b.test.ts', source: `${HARNESS}describe('step 2: a data file', () => {})\ndescribe('step 3: from the future', () => {})` }

    expect(stepNamingProblems(STEPS, [STEP_1, stale])).toEqual(['migrations.b.test.ts names step 3, but MIGRATIONS has steps 1–2'])
  })

  test.each([
    ['an import wrapped over lines', "import {\n  open,\n  writeFile,\n} from './migrationsHarness.js'\n"],
    ['a bare import', "import './migrationsHarness.js'\n"],
  ])('takes %s of the harness', (_, harness) => {
    const step2 = { file: 'migrations.b.test.ts', source: `${harness}describe('step 2: a data file', () => {})` }

    expect(stepNamingProblems(STEPS, [STEP_1, step2])).toEqual([])
  })

  test('takes no type-only import of the harness, which runs none of its checks', () => {
    const typeOnly = { file: 'migrations.b.test.ts', source: "import type { Opened } from './migrationsHarness.js'\ndescribe('step 2: a data file', () => {})" }

    expect(stepNamingProblems(STEPS, [STEP_1, typeOnly])).toEqual([
      "migrations.b.test.ts names a step but doesn't import migrationsHarness.ts, which checks what each step's test writes",
    ])
  })

  test.each([
    ['describe.skip', "describe.skip('step 2: a data file', () => {})"],
    ['test.skip', "describe('step 2: a data file', () => {\n  test.skip('keeps it', () => {})\n})"],
    ['test.todo', "describe('step 2: a data file', () => {\n  test.todo('keeps it')\n})"],
    ['it.skipIf', "describe('step 2: a data file', () => {\n  it.skipIf(slow)('keeps it', () => {})\n})"],
    ['test.only', "describe('step 2: a data file', () => {\n  test.only('keeps it', () => {})\n})"],
  ])('fails on a file naming a step that runs a test only some of the time, with %s, naming it', (_, source) => {
    const sometimes = { file: 'migrations.b.test.ts', source: `${HARNESS}describe('step 2: before', () => {})\n${source}` }

    expect(stepNamingProblems(STEPS, [STEP_1, sometimes])).toContain(
      'migrations.b.test.ts names a step and skips, todos or singles out a test: every test in a file naming a step runs, so each step has a test that ran',
    )
  })

  test("fails on a file naming a step that doesn't arrange through the harness, naming it", () => {
    const unchecked = { file: 'migrations.b.test.ts', source: "describe('step 2: a data file', () => {})" }

    expect(stepNamingProblems(STEPS, [STEP_1, unchecked])).toEqual([
      "migrations.b.test.ts names a step but doesn't import migrationsHarness.ts, which checks what each step's test writes",
    ])
  })
})
