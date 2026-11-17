import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { TEAM, AN_ISO_TIMESTAMP, fileIn, closeStorage, writeFile, open, versionOf, schemaOf, rowsOf, EDITED_RANGES } from './migrationsHarness.js'
import { UNVERSIONED_SCHEMA } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

describe('a data file written before schema versions', () => {
  test('opens and keeps its team, and its facts, milestone and pace setting', () => {
    const file = writeFile('old.db', UNVERSIONED_SCHEMA)

    expect(open(file).teams()).toEqual([{ id: TEAM, name: 'Acme', source: 'jira', sourceRef: TEAM, installedAt: AN_ISO_TIMESTAMP }])
    expect(rowsOf(file, 'SELECT id, parent_id, labels, started_at FROM work_items ORDER BY rowid')).toEqual([
      { id: 'E1', parent_id: null, labels: '[]', started_at: null },
      { id: 'S1', parent_id: 'E1', labels: '["web"]', started_at: '2026-09-02T09:00:00Z' },
    ])
    expect(rowsOf(file, 'SELECT item_id, from_value, to_value FROM work_item_events')).toEqual([
      { item_id: 'S1', from_value: 'To Do', to_value: 'In Progress' },
    ])
    expect(rowsOf(file, 'SELECT id, name, committed_date FROM milestones')).toEqual([{ id: 'M1', name: 'Launch', committed_date: '2026-12-18' }])
    expect(rowsOf(file, 'SELECT milestone_id, epic_id FROM milestone_epics')).toEqual([{ milestone_id: 'M1', epic_id: 'E1' }])
    expect(rowsOf(file, 'SELECT milestone_id, mode, low, high FROM pace_settings')).toEqual([{ milestone_id: 'M1', mode: 'manual', low: 3, high: 7 }])
  })
})

describe('schema version', () => {
  test('a fresh file and an upgraded file record the same version, above the unversioned one', () => {
    const fresh = fileIn('fresh.db')
    open(fresh)
    const old = writeFile('old.db', UNVERSIONED_SCHEMA)
    open(old)

    expect(versionOf(fresh)).toBeGreaterThan(0)
    expect(versionOf(old)).toBe(versionOf(fresh))
  })

  test('a fresh file and an upgraded file end up with the same tables, columns and indexes', () => {
    const fresh = fileIn('fresh.db')
    open(fresh)
    const old = writeFile('old.db', UNVERSIONED_SCHEMA)
    open(old)
    closeStorage()

    expect(schemaOf(old)).toEqual(schemaOf(fresh))
  })

  test('an upgraded file opens again unchanged in version and content, and takes new data', () => {
    const file = writeFile('old.db', UNVERSIONED_SCHEMA)
    open(file)
    const version = versionOf(file)

    open(file).saveAmbiguityRanges(EDITED_RANGES)

    expect(versionOf(file)).toBe(version)
    const reopened = open(file)
    expect(reopened.milestoneInputs(TEAM)).toMatchObject({ name: 'Launch', paceRange: { low: 3, high: 7 } })
    expect(reopened.ambiguityRanges(TEAM)).toEqual(EDITED_RANGES)
    expect(rowsOf(file, 'SELECT id FROM work_items ORDER BY rowid')).toEqual([{ id: 'E1' }, { id: 'S1' }])
  })
})

describe('a data file from a newer release', () => {
  test('refuses to open, says why, and leaves the file as it was', () => {
    const file = writeFile('newer.db', 'CREATE TABLE from_the_future (id TEXT);', 999)
    const before = readFileSync(file)

    expect(() => open(file)).toThrow(/newer version of the Forecaster.*schema 999/)
    expect(() => open(file)).toThrow(file)
    expect(readFileSync(file)).toEqual(before)
    expect(versionOf(file)).toBe(999)
  })
})
