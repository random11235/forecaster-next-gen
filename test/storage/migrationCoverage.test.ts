import { readdirSync, readFileSync } from 'node:fs'
import { relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MIGRATIONS_FILE, migrationSteps } from '../../scripts/migrationSteps.ts'
import { stepNamedBy, versionBefore } from './migrationStep.js'

// The Migration tests section of docs/design/architecture-test-seams-storage.md: every step of MIGRATIONS has a test
// that opens a data file as it was before that step, named in a top-level `describe('step N: …')`, at column 0
// (migrationStep.ts). This file checks the names: each step is named by exactly one describe, none names a step
// MIGRATIONS doesn't have, no step describe is indented (inside an `if`, a helper nobody calls or an empty
// `describe.each` it may never register, and inside another describe it isn't the top-level one the harness reads),
// and a file naming one arranges through migrationsHarness.ts, which checks what each test under a step's
// describe writes as it runs, and has no word that skips, todos, singles out, runs concurrently or expects to fail a
// test, so each step's describe holds a test that runs, one at a time, and must pass (Vitest fails one holding none).
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

/** The step each `describe('…')` in `source`, outside block comments, names, as `at` finds them: indented or not. */
function stepDescribes(source: string, at: RegExp): number[] {
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...uncommented.matchAll(at)].flatMap((match) => stepNamedBy(match[2] ?? '') ?? [])
}

/**
 * The steps `source` names, each in a `describe('step N: …')` at the start of its line with no indent, in any quotes:
 * Prettier indents a describe in anything (an `if`, a function, another describe), so one at column 0 is at the top
 * level of its file and always registers. A describe in a block comment or after `//` names none.
 */
const stepsNamedIn = (source: string): number[] => stepDescribes(source, /^describe\(\s*(['"`])(.*?)\1/gm)

/**
 * The steps `source` has an indented `describe('step N: …')` for, which names none: in an `if`, an uncalled helper or
 * an empty `describe.each` it may never register, and in another describe it isn't the top-level one the harness reads.
 */
const indentedSteps = (source: string): number[] => stepDescribes(source, /^[ \t]+describe\(\s*(['"`])(.*?)\1/gm)

/**
 * Whether `source` imports migrationsHarness.ts, which checks what each step's test writes: its bindings, wrapped over
 * lines or not, or the bare module. A type-only import runs none of it.
 */
const usesHarness = (source: string): boolean => /^import\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?'\.\/migrationsHarness\.js'/m.test(source)

/**
 * The words that skip, todo, single out, run concurrently or expect to fail a test or describe in Vitest, in any of
 * its forms.
 */
const NOT_PLAINLY_RUN = /\b(?:skip|todo|only|skipIf|runIf|concurrent|fails)\b/

/**
 * The first word of NOT_PLAINLY_RUN in `source`, outside its comments, if any: a file that has one may hold a step
 * whose tests none ran (Vitest itself fails a describe holding no test), run them at once, which the harness's one
 * list of writes can't follow, or expect them to fail, which hides the harness's errors. A word meaning something else fails too, loudly.
 */
function wordNotPlainlyRun(source: string): string | undefined {
  const uncommented = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  return NOT_PLAINLY_RUN.exec(uncommented)?.[0]
}

/**
 * What is wrong with how `tests` name the steps of MIGRATIONS (`steps`, each step's text as migrationSteps gives
 * it), one sentence each: a step no describe names, naming it by its comment; a step named more than once; a step
 * named that MIGRATIONS doesn't have; an indented step describe; a file naming a step that doesn't arrange through the harness, or that has a word of
 * NOT_PLAINLY_RUN. Each names the files.
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
  const indented = tests.flatMap(({ file, source }) =>
    [...new Set(indentedSteps(source))].map(
      (step) =>
        `${file} has an indented describe('step ${step}: …'): a step's describe sits at the top level of its file, with no indent, so it always registers`,
    ),
  )
  const notPlainlyRun = tests.flatMap(({ file, source }) => {
    const word = stepsNamedIn(source).length > 0 ? wordNotPlainlyRun(source) : undefined
    return word === undefined
      ? []
      : [
          `${file} names a step and has \`${word}\`: every test in a file naming a step must run, one at a time, and pass, so each step has a test that runs and is write-checked`,
        ]
  })
  return [...untested, ...misnamed, ...unchecked, ...indented, ...notPlainlyRun]
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

  test('passes when each step is named once, in any of the files, in any quotes', () => {
    const step2 = { file: 'migrations.b.test.ts', source: `${HARNESS}describe("step 2: a data file", () => {\n  describe('a group', () => {})\n})` }

    expect(stepNamingProblems(STEPS, [STEP_1, step2])).toEqual([])
  })

  test.each([
    ['in another describe', "describe('a group', () => {\n  describe('step 2: a data file', () => {})\n})"],
    ['in an if', "if (process.env.SLOW_MIGRATIONS) {\n  describe('step 2: a data file', () => {})\n}"],
    ['in a helper nobody calls', "function slow(): void {\n  describe('step 2: a data file', () => {})\n}"],
    ['in a describe.each', "describe.each([])('%s', () => {\n  describe('step 2: a data file', () => {})\n})"],
  ])(
    'fails on a step describe %s, which may never register or is not the top-level one the harness reads, naming the file, and counts no step for it',
    (_, code) => {
      const indented = { file: 'migrations.b.test.ts', source: `${HARNESS}${code}` }

      expect(stepNamingProblems(STEPS, [STEP_1, indented])).toEqual([
        UNTESTED_STEP_2,
        "migrations.b.test.ts has an indented describe('step 2: …'): a step's describe sits at the top level of its file, with no indent, so it always registers",
      ])
    },
  )

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
    ['describe.skip', "describe.skip('step 2: a data file', () => {})", 'skip'],
    ['test.skip', "test.skip('keeps it', () => {})", 'skip'],
    ['test.todo', "test.todo('keeps it')", 'todo'],
    ['it.skipIf', "it.skipIf(slow)('keeps it', () => {})", 'skipIf'],
    ['it.runIf', "it.runIf(fast)('keeps it', () => {})", 'runIf'],
    ['test.only', "test.only('keeps it', () => {})", 'only'],
    ['test.concurrent.skip', "test.concurrent.skip('keeps it', () => {})", 'concurrent'],
    ['describe.sequential.only', "describe.sequential.only('a group', () => {})", 'only'],
    ['suite.skip', "suite.skip('a group', () => {})", 'skip'],
    ['the skip option', "test('keeps it', { skip: true }, () => {})", 'skip'],
    ['ctx.skip()', "test('keeps it', (ctx) => {\n  ctx.skip()\n})", 'skip'],
    ['a skip fixture', "test('keeps it', ({ skip }) => skip())", 'skip'],
    ['describe.concurrent', "describe.concurrent('a group', () => {})", 'concurrent'],
    ['test.fails', "test.fails('writes nothing', () => {\n    throw new Error('no file')\n  })", 'fails'],
  ])('fails on a file naming a step that has %s, naming the file and the word', (_, code, word) => {
    const file = { file: 'migrations.b.test.ts', source: `${HARNESS}describe('step 2: a data file', () => {\n  ${code}\n})` }

    expect(stepNamingProblems(STEPS, [STEP_1, file])).toEqual([
      `migrations.b.test.ts names a step and has \`${word}\`: every test in a file naming a step must run, one at a time, and pass, so each step has a test that runs and is write-checked`,
    ])
  })

  test.each([
    ['a line comment', '// skip this one only when the tracker is down, and it fails'],
    ['a block comment', '/* only the todo here */'],
    ['a longer word', "const skipped = 'onlyOne failsafe'"],
  ])('flags no word in %s', (_, code) => {
    const file = { file: 'migrations.b.test.ts', source: `${HARNESS}${code}\ndescribe('step 2: a data file', () => {})` }

    expect(stepNamingProblems(STEPS, [STEP_1, file])).toEqual([])
  })

  test("fails on a file naming a step that doesn't arrange through the harness, naming it", () => {
    const unchecked = { file: 'migrations.b.test.ts', source: "describe('step 2: a data file', () => {})" }

    expect(stepNamingProblems(STEPS, [STEP_1, unchecked])).toEqual([
      "migrations.b.test.ts names a step but doesn't import migrationsHarness.ts, which checks what each step's test writes",
    ])
  })
})
