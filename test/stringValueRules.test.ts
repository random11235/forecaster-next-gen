import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'
import { codeOf } from './sourceCode.js'

// String values in union types are camelCase, like the TypeScript identifiers around them: 'howMany',
// 'ticketsRemaining'. They are stored and shown, so renaming one later breaks saved data. The schema's CHECK
// constraints hold the stored copies of those values, so their allowed values are camelCase too.

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/

/**
 * The union values that name something else, kept in its own spelling, by file under `src/`: the SQLite columns a
 * refusal of stored JSON names, in the schema's snake_case. They are never stored.
 */
const NAMING_ELSEWHERE: Record<string, readonly string[]> = {
  'storage/lib/milestoneQueryTables.ts': [
    'milestone_queries.picks',
    'comparable_work_queries.picks',
    'setup_drafts.milestone_picks',
    'setup_drafts.comparable_work_picks',
  ],
}

/** Each `.ts` file under `src/<folder>`, relative to `src/`, with its source. */
function sourceFiles(folder: string): { file: string; source: string }[] {
  return readdirSync(join(src, folder), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(folder, file))
    .map((file) => ({ file, source: readFileSync(join(src, file), 'utf8') }))
}

/**
 * The string-literal union members in `source`'s code: each quoted string with a lone `|` before or after it, so the
 * first member of a union too. Comments, regex literals, template text and `||` don't count.
 */
function unionValues(source: string): string[] {
  const code = codeOf(source)
  return [...code.matchAll(/(['"])[^'"\n]*\1/g)]
    .filter(({ index, 0: quoted }) => {
      const before = code.slice(0, index).trimEnd()
      const after = code.slice(index + quoted.length).trimStart()
      return (before.endsWith('|') && !before.endsWith('||')) || (after.startsWith('|') && !after.startsWith('||'))
    })
    .map(({ index, 0: quoted }) => source.slice(index + 1, index + quoted.length - 1))
}

/** The values `source`'s SQL `CHECK (column IN (…))` constraints allow. */
function checkValues(source: string): string[] {
  return [...source.matchAll(/\bCHECK\s*\(\s*[\w"]+\s+IN\s*\(([^)]*)\)/gi)].flatMap(([, allowed]) =>
    [...allowed!.matchAll(/'([^']*)'/g)].map(([, value]) => value!),
  )
}

describe('string value rules', () => {
  test("every string-literal union member in src/ is camelCase, but the ones naming something in its own spelling", () => {
    const files = sourceFiles('')
    const values = files.flatMap(({ file, source }) => unionValues(source).map((value) => ({ file, value })))
    const offending = values.filter(({ file, value }) => !CAMEL_CASE.test(value) && !NAMING_ELSEWHERE[file]?.includes(value))

    expect(values.map(({ value }) => value)).toContain('ticketsRemaining')
    expect(offending).toEqual([])
  })

  test("every value a CHECK constraint in src/storage/ allows is camelCase", () => {
    const values = sourceFiles('storage').flatMap(({ file, source }) => checkValues(source).map((value) => ({ file, value })))

    expect(values.filter(({ value }) => !CAMEL_CASE.test(value))).toEqual([])
  })

  test.each([
    ['a union', "type Method = 'howMany' | 'whenDone'", ['howMany', 'whenDone']],
    ['a union on lines of its own', "type Method =\n  | 'howMany'\n  | 'when_done'", ['howMany', 'when_done']],
    ['a union in double quotes', 'let kind: "a" | "b_c"', ['a', 'b_c']],
    ['a union in a parameter', "function f(kind: 'some' | 'none_left') {}", ['some', 'none_left']],
  ])('finds the members of %s', (_, source, expected) => {
    expect(unionValues(source)).toEqual(expected)
  })

  test.each([
    ['a default after ||', "const name = given || 'some_default'"],
    ['a union in a comment', "// type Method = 'how_many' | 'when'"],
    ['a bar in a string', "const separator = 'a | b'"],
    ['a bar in a regex', "const quoted = /'a'|'b'/"],
    ['a bar in template text', "const shown = `'a' | 'b'`"],
  ])('finds no member in %s', (_, source) => {
    expect(unionValues(source)).toEqual([])
  })

  test('finds the values a CHECK constraint allows', () => {
    const schema = "CREATE TABLE setups (\n  closed_by TEXT CHECK (closed_by IN ('used', 'cancelled_early'))\n);"

    expect(checkValues(schema)).toEqual(['used', 'cancelled_early'])
  })
})
