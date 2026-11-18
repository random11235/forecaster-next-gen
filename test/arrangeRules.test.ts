import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { typeScriptSourcesUnder } from './sourceFiles.js'

// Tests arrange through the module: test setup calls storage's own functions, never writes rows or stored shapes in
// SQL or opens the database file itself, so a change to how storage keeps its data leaves the tests alone. Where a
// test needs a function storage doesn't have, it is added to storage.

const testDir = fileURLToPath(new URL('.', import.meta.url))

/** What gives SQL or the database away in a file: a write or a table made in SQL, or the database opened directly. */
const SQL = [/\bINSERT\s+INTO\b/, /\bUPDATE\s+\S+\s+SET\b/, /\bDELETE\s+FROM\b/, /\bCREATE\s+TABLE\b/, /\bnode:sqlite\b/, /\bDatabaseSync\b/]

/** The test files that may hold SQL or open the database, relative to `test/`, each with why. */
const EXCEPTIONS: Record<string, string> = {
  // Migration tests arrange stored data as it was before the migration, which storage no longer writes.
  'storage/migrations.beforeTheMvp.test.ts': 'arranges a pre-MVP data file',
  'storage/migrations.schemaVersion.test.ts': 'arranges data as it was before a migration',
  'storage/migrations.v1to5.test.ts': 'arranges data as it was before a migration',
  'storage/migrations.v16to19.test.ts': 'arranges data as it was before a migration',
  'storage/migrationsHarness.ts': 'opens a database at a past schema for the migration tests',
  'storage/pastSchemas.ts': 'the past schemas the migration tests start from',
  // Tests of unreadable stored data write what storage can't.
  'storage/storageContract.storedShape.test.ts': 'writes stored JSON of a shape this version does not read',
  'storage/storageContract.unknownValues.test.ts': 'writes stored values this version does not know',
  // Reads the stored values themselves, which no storage function shows.
  'storage/storageContract.storedValues.test.ts': 'reads which values storage writes',
  // The scan tests, whose SQL is the text they scan, in no database.
  'arrangeRules.test.ts': 'its cases',
  'sourceCode.test.ts': 'its cases',
  'stringValueRules.test.ts': 'its cases',
  'storage/migrationCoverage.test.ts': 'its cases',
  'storage/storedValues.test.ts': 'its cases',
}

/** Whether `source` writes or makes a table in SQL, or opens the database directly rather than through `openSqliteStorage`. */
function arrangesInSql(source: string): boolean {
  return SQL.some((pattern) => pattern.test(source))
}

describe('tests arrange through the module', () => {
  const files = typeScriptSourcesUnder(testDir)

  test('no test file but the exceptions writes SQL or opens the database directly', () => {
    const inSql = files.filter(({ file, source }) => !(file in EXCEPTIONS) && arrangesInSql(source))

    expect(inSql.map(({ file }) => file)).toEqual([])
  })

  test('each exception still needs to be one', () => {
    const needed = files.filter(({ file, source }) => file in EXCEPTIONS && arrangesInSql(source))

    expect(needed.map(({ file }) => file).sort()).toEqual(Object.keys(EXCEPTIONS).sort())
  })

  test.each([
    ['an INSERT', 'db.exec("INSERT INTO teams (id) VALUES (\'team\')")'],
    ['an UPDATE', "db.prepare('UPDATE setups SET closed = ?').run('done')"],
    ['an UPDATE of a table named in a template', 'db.prepare(`UPDATE ${table} SET ${column} = ?`)'],
    ['a DELETE', "db.exec('DELETE FROM teams')"],
    ['a CREATE TABLE', 'db.exec(`CREATE TABLE teams (id TEXT)`)'],
    ['node:sqlite imported', "import { DatabaseSync } from 'node:sqlite'"],
    ['the database opened directly', 'const db = new DatabaseSync(file)'],
  ])('catches %s', (_, source) => {
    expect(arrangesInSql(source)).toBe(true)
  })

  test.each([
    ['storage opened through openSqliteStorage', 'const storage = openSqliteStorage(file)\nstorage.saveTeam(TEAM)'],
    ['words that read like SQL in a test name', "test('update the setup, then insert into the draft', () => {})"],
  ])('passes %s', (_, source) => {
    expect(arrangesInSql(source)).toBe(false)
  })
})
