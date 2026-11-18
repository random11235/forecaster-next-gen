import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { src } from './importScan.js'
import { codeOf, templateTextsOf } from './sourceCode.js'
import { type SourceFile, typeScriptSourcesUnder } from './sourceFiles.js'
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

/** A string-literal union member in a file under `src/`, with the type alias whose whole type is its union, if any. */
interface UnionMember {
  file: string
  value: string
  alias: string | undefined
}

/** Each `.ts` file under `src/<folder>`, relative to `src/`, with its source. */
function srcFilesIn(folder: string): SourceFile[] {
  return typeScriptSourcesUnder(join(src, folder), src)
}

/**
 * The string-literal union members in `source`'s code: each quoted string with a lone `|` before or after it, so the
 * first member of a union too. `||` doesn't count, nor anything outside the code `codeOf` gives. Each comes with the
 * type alias whose whole type is its union (`type PicksColumn = 'a' | 'b'`), if there is one.
 */
function unionMembers({ file, source }: SourceFile): UnionMember[] {
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
      return { file, value: source.slice(index + 1, index + quoted.length - 1), alias: wholeUnion ? alias[1] : undefined }
    })
}

/** Whether `member` is a member of `NAMING_ELSEWHERE`'s union. */
function namesElsewhere({ file, alias }: UnionMember): boolean {
  return file === NAMING_ELSEWHERE.file && alias === NAMING_ELSEWHERE.alias
}

/** A quoted SQL string, its quote doubled inside it. */
const SQL_STRING = /'(?:[^']|'')*'/

/** `sql` without its comments (`--` to the end of the line, and block comments), its strings kept whatever they hold. */
function withoutSqlComments(sql: string): string {
  const stringOrComment = new RegExp(String.raw`${SQL_STRING.source}|/\*[\s\S]*?\*/|--[^\n]*`, 'g')
  return sql.replace(stringOrComment, (found) => (found.startsWith("'") ? found : ' '))
}

/**
 * The SQL in `source`: the text of each of its templates that creates or alters a table, a whole template whatever its
 * `${…}`s, without its comments. The code around it, and its comments and strings, don't count.
 */
function sqlOf(source: string): string[] {
  return templateTextsOf(source)
    .filter((text) => /\b(?:CREATE|ALTER)\s+TABLE\b/i.test(text))
    .map(withoutSqlComments)
}

/** The text of each `CHECK (…)` constraint in `sql`, inside its parentheses: nested ones, and any in its strings, too. */
function checkBodies(sql: string): string[] {
  return [...sql.matchAll(/\bCHECK\s*\(/gi)].map(({ index, 0: opening }) => {
    const start = index + opening.length
    const string = new RegExp(SQL_STRING.source, 'y')
    let depth = 1
    let at = start
    while (at < sql.length && depth > 0) {
      string.lastIndex = at
      const quoted = string.exec(sql)
      if (quoted) at += quoted[0].length
      else {
        if (sql[at] === '(') depth++
        if (sql[at] === ')') depth--
        at++
      }
    }
    return sql.slice(start, depth === 0 ? at - 1 : at)
  })
}

/**
 * The values `source`'s SQL `CHECK` constraints allow: each `IN (…)` list in one, beside other conditions too (`x IS
 * NULL OR x IN (…)`), but not a `NOT IN (…)` list, which rules values out.
 */
function checkValues(source: string): string[] {
  const allowedList = new RegExp(String.raw`(?<!\bNOT\s+)\bIN\s*\((?:${SQL_STRING.source}|[^')])*\)`, 'gi')
  return sqlOf(source)
    .flatMap(checkBodies)
    .flatMap((body) => [...body.matchAll(allowedList)])
    .flatMap(([allowed]) => [...allowed.matchAll(new RegExp(SQL_STRING.source, 'g'))].map(([quoted]) => quoted.slice(1, -1).replaceAll("''", "'")))
}

describe('string value rules', () => {
  test('every value of every union storage stores is camelCase', () => {
    const values = Object.entries(STORED_UNIONS).flatMap(([union, { values }]) => Object.keys(values).map((value) => ({ union, value })))

    expect(values.filter(({ value }) => !CAMEL_CASE.test(value))).toEqual([])
  })

  test(`every string-literal union member in src/ is camelCase, but ${NAMING_ELSEWHERE.alias}'s, which names columns`, () => {
    const members = srcFilesIn('').flatMap(unionMembers)
    const offending = members.filter((member) => !CAMEL_CASE.test(member.value) && !namesElsewhere(member))

    expect(members.map(({ value }) => value)).toContain('ticketsRemaining')
    expect(members.some(namesElsewhere)).toBe(true)
    expect(offending.map(({ file, value }) => ({ file, value }))).toEqual([])
  })

  test('every value a CHECK constraint in src/storage/ allows is camelCase', () => {
    const files = srcFilesIn('storage')
    const values = files.flatMap(({ file, source }) => checkValues(source).map((value) => ({ file, value })))

    const schema = files.find(({ file }) => file === 'storage/sqliteStorage.ts')
    const tables = sqlOf(schema?.source ?? '').flatMap((sql) => [...sql.matchAll(/\bCREATE TABLE (?:IF NOT EXISTS )?(\w+)/g)].map(([, table]) => table))

    // The schema has no CHECK constraint yet, so no value can show the scan reads it: the SQL it reads must hold the
    // schema's tables.
    expect(tables).toEqual(expect.arrayContaining(['teams', 'setups', 'read_failures']))
    expect(values.filter(({ value }) => !CAMEL_CASE.test(value))).toEqual([])
  })

  test.each([
    ['a union', "type Method = 'howMany' | 'whenDone'", ['howMany', 'whenDone']],
    ['a union on lines of its own', "type Method =\n  | 'howMany'\n  | 'when_done'", ['howMany', 'when_done']],
    ['a union in double quotes', 'let kind: "a" | "b_c"', ['a', 'b_c']],
    ['a union in a parameter', "function f(kind: 'some' | 'none_left') {}", ['some', 'none_left']],
  ])('finds the members of %s', (_, source, expected) => {
    expect(unionMembers({ file: 'example.ts', source }).map(({ value }) => value)).toEqual(expected)
  })

  test.each([
    ['a type alias that is the union', "type PicksColumn = 'a.b' | 'c.d'", ['PicksColumn', 'PicksColumn']],
    ['a type alias on lines of its own', "type PicksColumn =\n  | 'a.b'\n  | 'c.d'", ['PicksColumn', 'PicksColumn']],
    ['an exported type alias', "export type PicksColumn = 'a.b' | 'c.d'", ['PicksColumn', 'PicksColumn']],
    ['a union inside a type alias', "type Pick = { kind: 'epic' | 'label' }", [undefined, undefined]],
    ['a union after a type alias', "type PicksColumn = 'a.b' | 'c.d'\nfunction f(kind: 'e' | 'f') {}", ['PicksColumn', 'PicksColumn', undefined, undefined]],
  ])('names the type alias of %s, only when the union is all of it', (_, source, expected) => {
    expect(unionMembers({ file: 'example.ts', source }).map(({ alias }) => alias)).toEqual(expected)
  })

  test.each([
    ['a default after ||', "const name = given || 'some_default'"],
    ['a bar in a string', "const separator = 'a | b'"],
  ])('finds no member in %s', (_, source) => {
    expect(unionMembers({ file: 'example.ts', source })).toEqual([])
  })

  test.each([
    ['a CHECK constraint', "closed_by TEXT CHECK (closed_by IN ('used', 'cancelled_early'))", ['used', 'cancelled_early']],
    ['a CHECK that allows NULL too', "closed_by TEXT CHECK (closed_by IS NULL OR closed_by IN ('used', 'cancelled_early'))", ['used', 'cancelled_early']],
    ['a CHECK that also rules values out', "closed_by TEXT CHECK (closed_by NOT IN ('old_value') AND closed_by IN ('used'))", ['used']],
    ['a CHECK allowing a parenthesis', "kind TEXT CHECK (kind IN ('(', 'it''s')),\n  closed_by TEXT CHECK (closed_by IN ('used'))", ['(', "it's", 'used']],
    ['a CHECK allowing a comment marker', "kind TEXT CHECK (kind IN ('a--b', 'used'))", ['a--b', 'used']],
    [
      'a CHECK between strings holding block comment markers',
      "open TEXT DEFAULT '/*',\n  kind TEXT CHECK (kind IN ('used')),\n  close TEXT DEFAULT '*/'",
      ['used'],
    ],
  ])('finds the values %s allows', (_, column, expected) => {
    expect(checkValues(`db.exec(\`CREATE TABLE setups (\n  ${column}\n);\`)`)).toEqual(expected)
  })

  test('finds the values a CHECK allows after a substitution in the SQL', () => {
    expect(checkValues("db.exec(`CREATE TABLE ${table} (kind TEXT CHECK (kind IN ('used')))`)")).toEqual(['used'])
  })

  test('finds the values a CHECK allows in the SQL whatever the code around it holds', () => {
    const source = [
      "const open = '/*'",
      "for (let i = 1; i > 0; i--) db.exec(`CREATE TABLE setups (closed_by TEXT CHECK (closed_by IN ('used')));`)",
      "const close = '*/'",
    ].join('\n')

    expect(checkValues(source)).toEqual(['used'])
  })

  test('finds no CHECK outside SQL', () => {
    expect(checkValues("// CHECK (closed_by IN ('old_value'))\nconst shown = `CHECK (closed_by IN ('old_value'))`")).toEqual([])
  })

  test.each([
    ['a CHECK that only rules values out', "closed_by TEXT CHECK (closed_by NOT IN ('old_value'))"],
    ['a CHECK in a line comment', "closed_by TEXT -- was CHECK (closed_by IN ('old_value'))"],
    ['a CHECK in a block comment', "closed_by TEXT /* was CHECK (closed_by IN ('old_value')) */"],
  ])('finds no allowed value in %s', (_, column) => {
    expect(checkValues(`db.exec(\`CREATE TABLE setups (\n  ${column}\n);\`)`)).toEqual([])
  })
})
