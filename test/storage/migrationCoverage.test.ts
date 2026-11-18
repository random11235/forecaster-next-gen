import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { MIGRATIONS_FILE, migrationSteps } from '../../scripts/migrationSteps.ts'

// Part of CODING_STANDARDS.md's One-way doors: every step of MIGRATIONS has a test that opens a data file as it was
// before that step. A migration test names the step it runs in its `describe`, `step N: …`, writing a file at version
// N - 1 (step 1's, a file from before schema versions).

const root = fileURLToPath(new URL('../..', import.meta.url))
const here = fileURLToPath(new URL('.', import.meta.url))

/** Each migration test file in this folder, `migrations.*.test.ts`, with its source. */
function migrationTests(): { file: string; source: string }[] {
  return readdirSync(here)
    .filter((file) => /^migrations\..+\.test\.ts$/.test(file))
    .map((file) => ({ file, source: readFileSync(`${here}${file}`, 'utf8') }))
}

/** The steps `source` names in a `describe('step N: …')`. */
function stepsNamedIn(source: string): number[] {
  return [...source.matchAll(/\bdescribe\(\s*(['"`])step (\d+):/g)].map((match) => Number(match[2]))
}

/**
 * Each of `steps` (each step's text, as migrationSteps gives it) that no source in `tests` names, as a sentence naming
 * the step by its comment.
 */
function untestedSteps(steps: readonly string[], tests: readonly string[]): string[] {
  const named = new Set(tests.flatMap(stepsNamedIn))
  return steps.flatMap((step, i) => {
    const number = i + 1
    if (named.has(number)) return []
    const comment = step.split('\n')[0]?.trim()
    const from = number === 1 ? 'from before schema versions' : `at version ${number - 1}`
    return [`step ${number} (\`${comment}\`) has no test: add a describe('step ${number}: …') to a test/storage/migrations.*.test.ts that opens a file ${from}`]
  })
}

describe('migration coverage', () => {
  test(`every step of MIGRATIONS in ${MIGRATIONS_FILE} is named by a migration test`, () => {
    const steps = migrationSteps(readFileSync(`${root}${MIGRATIONS_FILE}`, 'utf8'), MIGRATIONS_FILE)

    expect(
      untestedSteps(
        steps,
        migrationTests().map(({ source }) => source),
      ),
    ).toEqual([])
  })

  const STEPS = ['  // 1: the first schema.\n  `CREATE TABLE a (id TEXT);`,', '  // 2: a second table.\n  `CREATE TABLE b (id TEXT);`,']

  test('fails on a step no test names, naming it by its comment', () => {
    const tests = ["describe('step 1: a data file from before schema versions', () => {})"]

    expect(untestedSteps(STEPS, tests)).toEqual([
      "step 2 (`// 2: a second table.`) has no test: add a describe('step 2: …') to a test/storage/migrations.*.test.ts that opens a file at version 1",
    ])
  })

  test('passes when each step is named, in any of the files, in any quotes', () => {
    const tests = ["describe('step 1: before schema versions', () => {})", 'describe("step 2: a data file from schema version 1", () => {})']

    expect(untestedSteps(STEPS, tests)).toEqual([])
  })

  test('takes no mention of a step but a describe naming it', () => {
    const tests = ["describe('step 1: before schema versions', () => {})", "// step 2: tested later\ntest('step 2: a data file', () => {})"]

    expect(untestedSteps(STEPS, tests)).toHaveLength(1)
  })
})
