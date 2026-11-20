import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { typeScriptSourcesUnder } from '../scripts/sourceFiles.ts'

// Tests arrange through the module: test setup calls storage's own functions, never writes rows or stored shapes in
// SQL or opens the database file itself, so a change to how storage keeps its data leaves the tests alone. Where a
// test needs a function storage doesn't have, it is added to storage.

const testDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * What gives a file away as going past storage: a write or a table made in SQL, or the database opened directly. SQL
 * in any case, but only with the structure that follows its keywords (a table and its columns or values, `SET column
 * =`), so words that read like SQL in prose pass.
 */
const PAST_STORAGE = [
  /\b(?:insert|replace)(?:\s+or\s+\w+)?\s+into\s+\S+\s*(?:\(|values\b|select\b|default\b)/i,
  /\bupdate(?:\s+or\s+\w+)?\s+\S+\s+set\s+\S+\s*=/i,
  /\bdelete\s+from\s+\S+?(?:\s+where\b|\s*['"`;)]|\s*$)/im,
  /\bcreate\s+(?:temp(?:orary)?\s+)?table\s+(?:if\s+not\s+exists\s+)?\S+\s*(?:\(|as\b)/i,
  /\bnode:sqlite\b/,
  /\bDatabaseSync\b/,
]

/** The test files that may hold SQL or open the database, relative to `test/`, each with why. */
const EXCEPTIONS: Record<string, string> = {
  // Migration tests arrange stored data as it was before the migration, which storage no longer writes.
  'storage/migrations.beforeTheMvp.test.ts': 'arranges a pre-MVP data file',
  'storage/migrations.schemaVersion.test.ts': 'arranges data as it was before a migration',
  'storage/migrations.v1to5.test.ts': 'arranges data as it was before a migration',
  'storage/migrations.v16to19.test.ts': 'arranges data as it was before a migration',
  'storage/migrationsHarness.ts': 'opens a database at a past schema for the migration tests',
  'storage/pastSchemas.ts': 'the past schemas the migration tests start from',
  // Tests of unreadable stored data write what storage can't, through the one helper that writes the file straight.
  'storage/sqliteStraight.ts': 'writes and reads the SQLite file past storage, for the files below',
  'storage/storageContract.storedShape.test.ts': 'writes stored JSON of a shape this version does not read',
  'storage/storageContract.unknownValues.test.ts': 'writes stored values this version does not know',
  'forecast/forecastLedger.unreadableResult.test.ts': 'writes a logged result this version does not read',
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
function goesPastStorage(source: string): boolean {
  return PAST_STORAGE.some((pattern) => pattern.test(source))
}

describe('tests arrange through the module', () => {
  const files = typeScriptSourcesUnder(testDir)

  test('no test file but the exceptions writes SQL or opens the database directly', () => {
    const pastStorage = files.filter(({ file, source }) => !(file in EXCEPTIONS) && goesPastStorage(source))

    expect(pastStorage.map(({ file }) => file)).toEqual([])
  })

  test('each exception still needs to be one', () => {
    const needed = files.filter(({ file, source }) => file in EXCEPTIONS && goesPastStorage(source))

    expect(needed.map(({ file }) => file).sort()).toEqual(Object.keys(EXCEPTIONS).sort())
  })

  test.each([
    ['an INSERT', 'db.exec("INSERT INTO teams (id) VALUES (\'team\')")'],
    ['an INSERT OR REPLACE', "db.prepare('INSERT OR REPLACE INTO setups (team_id, closed) VALUES (?, ?)')"],
    ['a REPLACE', 'db.exec("REPLACE INTO teams (id) VALUES (\'team\')")'],
    ['an INSERT in lowercase', "db.prepare('insert into teams (id) values (?)')"],
    ['an UPDATE', "db.prepare('UPDATE setups SET closed = ?').run('done')"],
    ['an UPDATE of a table named in a template', 'db.prepare(`UPDATE ${table} SET ${column} = ?`)'],
    ['an UPDATE OR IGNORE', "db.prepare('UPDATE OR IGNORE setups SET closed = ?')"],
    ['an UPDATE in lowercase', 'db.exec("update setups set closed = \'archived\'")'],
    ['a DELETE', "db.exec('DELETE FROM teams')"],
    ['a DELETE in lowercase', "db.exec('delete from teams where id = 1')"],
    ['a CREATE TABLE', 'db.exec(`CREATE TABLE teams (id TEXT)`)'],
    ['a CREATE TABLE in lowercase', "db.exec('create table if not exists teams (id text)')"],
    ['node:sqlite imported', "import { DatabaseSync } from 'node:sqlite'"],
    ['the database opened directly', 'const db = new DatabaseSync(file)'],
  ])('catches %s', (_, source) => {
    expect(goesPastStorage(source)).toBe(true)
  })

  test.each([
    ['storage opened through openSqliteStorage', 'const storage = openSqliteStorage(file)\nstorage.saveTeam(TEAM)'],
    ['words that read like SQL in a test name', "test('update the setup, then insert into the draft', () => {})"],
    ['more words that read like SQL', '// replace into the list what we delete from the draft, then create table rows for it'],
  ])('passes %s', (_, source) => {
    expect(goesPastStorage(source)).toBe(false)
  })
})
