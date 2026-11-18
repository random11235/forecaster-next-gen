import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'
import { codeOf, typeScriptFilesUnder } from './sourceCode.js'
import { STORED_UNIONS } from './storage/storedUnions.js'

// String values in union types are camelCase, like the TypeScript identifiers around them: 'howMany',
// 'ticketsRemaining'. They are stored and shown, so renaming one later breaks saved data. The schema's CHECK
// constraints hold the stored copies of those values, so their allowed values are camelCase too.
//
// Every stored value is checked through STORED_UNIONS (test/storage/storedUnions.ts), which the typecheck keeps
// complete. The text scan of src/ checks the rest, the values that are only shown, but sees only a quoted string with a
// lone `|` beside it. It misses a union's values written any other way: an `as const` array a union is taken from
// (`CHOICE_KINDS`), a lone literal type (an interface's `kind: 'milestoneStep'`), or a value only assigned or compared.

const CAMEL_CASE = /^[a-z][a-zA-Z0-9]*$/

/**
 * The one union whose values name something else, in its own spelling, by its type alias and its file under `src/`:
 * the SQLite columns a refusal of stored JSON names, in the schema's spelling. They are shown in refusal messages,
 * never stored.
 */
const NAMING_ELSEWHERE = { file: 'storage/lib/milestoneQueryTables.ts', alias: 'PicksColumn' }

/** Each `.ts` file under `src/<folder>`, relative to `src/`, with its source. */
function srcFilesIn(folder: string): { file: string; source: string }[] {
  return typeScriptFilesUnder(join(src, folder))
    .map((file) => join(folder, file))
    .map((file) => ({ file, source: readFileSync(join(src, file), 'utf8') }))
}

/**
 * The string-literal union members in `source`'s code: each quoted string with a lone `|` before or after it, so the
 * first member of a union too. `||` doesn't count, nor anything outside the code `codeOf` gives. Each comes with the
 * type alias whose whole type is its union (`type PicksColumn = 'a' | 'b'`), if there is one.
 */
function unionValues(source: string): { value: string; alias: string | undefined }[] {
  const code = codeOf(source)
  const aliases = [...code.matchAll(/\btype\s+([\p{L}_$][\p{L}\p{N}_$]*)\s*=/gu)]
  return [...code.matchAll(/(['"])[^'"\n]*\1/g)]
    .filter(({ index, 0: quoted }) => {
      const before = code.slice(0, index).trimEnd()
      const after = code.slice(index + quoted.length).trimStart()
      return (before.endsWith('|') && !before.endsWith('||')) || (after.startsWith('|') && !after.startsWith('||'))
    })
    .map(({ index, 0: quoted }) => {
      const alias = aliases.filter((each) => each.index < index).at(-1)
      const sinceAlias = alias === undefined ? '' : code.slice(alias.index + alias[0].length, index)
      const wholeUnion = alias !== undefined && /^\s*(?:\|\s*)?(?:(['"])\s*\1\s*\|\s*)*$/.test(sinceAlias)
      return { value: source.slice(index + 1, index + quoted.length - 1), alias: wholeUnion ? alias[1] : undefined }
    })
}

/** `sql` without its comments: `--` to the end of the line, and block comments. */
function withoutSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\/|--[^\n]*/g, ' ')
}

/** The text of each `CHECK (…)` constraint in `sql`, inside its parentheses, nested ones too. */
function checkBodies(sql: string): string[] {
  return [...sql.matchAll(/\bCHECK\s*\(/gi)].map(({ index, 0: opening }) => {
    const start = index + opening.length
    let depth = 1
    let end = start
    for (; end < sql.length && depth > 0; end++) depth += sql[end] === '(' ? 1 : sql[end] === ')' ? -1 : 0
    return sql.slice(start, end - 1)
  })
}

/**
 * The values `source`'s SQL `CHECK` constraints allow: each `IN (…)` list in one, beside other conditions too (`x IS
 * NULL OR x IN (…)`), but not a `NOT IN (…)` list, which rules values out. Constraints in SQL comments don't count.
 */
function checkValues(source: string): string[] {
  return checkBodies(withoutSqlComments(source)).flatMap((body) =>
    [...body.matchAll(/(?<!\bNOT\s+)\bIN\s*\([^)]*\)/gi)].flatMap(([allowed]) => [...allowed.matchAll(/'[^']*'/g)].map(([quoted]) => quoted.slice(1, -1))),
  )
}

describe('string value rules', () => {
  test('every value of every union storage stores is camelCase', () => {
    const values = Object.entries(STORED_UNIONS).flatMap(([union, { values }]) => Object.keys(values).map((value) => ({ union, value })))

    expect(values.filter(({ value }) => !CAMEL_CASE.test(value))).toEqual([])
  })

  test(`every string-literal union member in src/ is camelCase, but ${NAMING_ELSEWHERE.alias}'s, which names columns`, () => {
    const values = srcFilesIn('').flatMap(({ file, source }) => unionValues(source).map((each) => ({ file, ...each })))
    const exempt = ({ file, alias }: { file: string; alias: string | undefined }): boolean => file === NAMING_ELSEWHERE.file && alias === NAMING_ELSEWHERE.alias
    const offending = values.filter((each) => !CAMEL_CASE.test(each.value) && !exempt(each))

    expect(values.map(({ value }) => value)).toContain('ticketsRemaining')
    expect(values.some(exempt)).toBe(true)
    expect(offending.map(({ file, value }) => ({ file, value }))).toEqual([])
  })

  test('every value a CHECK constraint in src/storage/ allows is camelCase', () => {
    const files = srcFilesIn('storage')
    const values = files.flatMap(({ file, source }) => checkValues(source).map((value) => ({ file, value })))

    expect(files.filter(({ source }) => /\bCREATE TABLE\b/.test(withoutSqlComments(source))).map(({ file }) => file)).toContain('storage/sqliteStorage.ts')
    expect(values.filter(({ value }) => !CAMEL_CASE.test(value))).toEqual([])
  })

  test.each([
    ['a union', "type Method = 'howMany' | 'whenDone'", ['howMany', 'whenDone']],
    ['a union on lines of its own', "type Method =\n  | 'howMany'\n  | 'when_done'", ['howMany', 'when_done']],
    ['a union in double quotes', 'let kind: "a" | "b_c"', ['a', 'b_c']],
    ['a union in a parameter', "function f(kind: 'some' | 'none_left') {}", ['some', 'none_left']],
  ])('finds the members of %s', (_, source, expected) => {
    expect(unionValues(source).map(({ value }) => value)).toEqual(expected)
  })

  test.each([
    ['a type alias that is the union', "type PicksColumn = 'a.b' | 'c.d'", ['PicksColumn', 'PicksColumn']],
    ['a type alias on lines of its own', "type PicksColumn =\n  | 'a.b'\n  | 'c.d'", ['PicksColumn', 'PicksColumn']],
    ['an exported type alias', "export type PicksColumn = 'a.b' | 'c.d'", ['PicksColumn', 'PicksColumn']],
    ['a union inside a type alias', "type Pick = { kind: 'epic' | 'label' }", [undefined, undefined]],
    ['a union after a type alias', "type PicksColumn = 'a.b' | 'c.d'\nfunction f(kind: 'e' | 'f') {}", ['PicksColumn', 'PicksColumn', undefined, undefined]],
  ])('names the type alias of %s, only when the union is all of it', (_, source, expected) => {
    expect(unionValues(source).map(({ alias }) => alias)).toEqual(expected)
  })

  test.each([
    ['a default after ||', "const name = given || 'some_default'"],
    ['a bar in a string', "const separator = 'a | b'"],
  ])('finds no member in %s', (_, source) => {
    expect(unionValues(source)).toEqual([])
  })

  test.each([
    ['a CHECK constraint', "closed_by TEXT CHECK (closed_by IN ('used', 'cancelled_early'))", ['used', 'cancelled_early']],
    ['a CHECK that allows NULL too', "closed_by TEXT CHECK (closed_by IS NULL OR closed_by IN ('used', 'cancelled_early'))", ['used', 'cancelled_early']],
    ['a CHECK that also rules values out', "closed_by TEXT CHECK (closed_by NOT IN ('old_value') AND closed_by IN ('used'))", ['used']],
  ])('finds the values %s allows', (_, column, expected) => {
    expect(checkValues(`CREATE TABLE setups (\n  ${column}\n);`)).toEqual(expected)
  })

  test.each([
    ['a CHECK that only rules values out', "closed_by TEXT CHECK (closed_by NOT IN ('old_value'))"],
    ['a CHECK in a line comment', "closed_by TEXT -- was CHECK (closed_by IN ('old_value'))"],
    ['a CHECK in a block comment', "closed_by TEXT /* was CHECK (closed_by IN ('old_value')) */"],
  ])('finds no allowed value in %s', (_, column) => {
    expect(checkValues(`CREATE TABLE setups (\n  ${column}\n);`)).toEqual([])
  })
})
