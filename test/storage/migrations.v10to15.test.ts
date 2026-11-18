import { describe, expect, test } from 'vitest'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { writeFile, open, versionOf, rowsOf } from './migrationsHarness.js'
import { TEAM, VERSION_10_SCHEMA, VERSION_11_SCHEMA, VERSION_12_SCHEMA, VERSION_13_SCHEMA, VERSION_14_SCHEMA, VERSION_15_SCHEMA } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

describe('step 11: a data file from schema version 10, before the new usual', () => {
  test('keeps its entries, none accepted or kept, and takes an accept and a keep, which survive reopening', () => {
    const file = writeFile('v10.db', VERSION_10_SCHEMA, 10)
    const storage = open(file)
    const lasting = { id: 2, from: '2026-08-03', to: undefined, percent: 80, note: 'Two left' }
    expect(storage.capacityEntries(TEAM)).toEqual([{ id: 1, from: '2026-09-07', to: '2026-09-07', percent: 0, note: 'Holiday' }, lasting])

    const accepted = { ...lasting, to: '2026-11-11', newUsualOn: '2026-11-11' }
    const kept = { id: 3, from: '2026-10-05', to: undefined, percent: 120, note: '', kept: true as const }
    storage.saveCapacityEntries(TEAM, [accepted, kept])

    expect(open(file).capacityEntries(TEAM)).toEqual([accepted, kept])
  })
})

describe('step 12: a data file from schema version 11, before the pace window', () => {
  test('keeps its milestone with no action on its pace, and takes one, which survives reopening', () => {
    const file = writeFile('v11.db', VERSION_11_SCHEMA, 11)
    const storage = open(file)
    const before = storage.milestoneInputs(TEAM)!
    expect(before).toMatchObject({ name: 'Launch', paceCounts: [6, 9], paceWindow: { action: undefined } })

    const acted = { ...before, paceWindow: { action: { kind: 'leaveOut' as const, period: '2026-08-17' }, skippedPeriods: [] } }
    storage.saveMilestoneInputs(acted)

    expect(open(file).milestoneInputs(TEAM)).toEqual(acted)
  })
})

describe('step 13: a data file from schema version 12, before the connection', () => {
  test('keeps its milestone, has no connection, and takes one, which survives reopening with no token in the file', () => {
    const file = writeFile('v12.db', VERSION_12_SCHEMA, 12)
    const storage = openSqliteStorage(file)
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ name: 'Launch', paceCounts: [6, 9] })
    expect(storage.connection(TEAM)).toBeUndefined()

    const jira = { tracker: 'jira' as const, site: 'acme.atlassian.net', projectKey: 'ACME', email: 'em@acme.example' }
    storage.saveConnection(TEAM, jira)
    storage.close()

    const again = openSqliteStorage(file)
    expect(again.connection(TEAM)).toEqual(jira)
    again.close()
    expect(rowsOf(file, 'SELECT * FROM connections')).toEqual([
      { team_id: TEAM, tracker: 'jira', owner: null, repo: null, site: 'acme.atlassian.net', project_key: 'ACME', email: 'em@acme.example' },
    ])
    expect(versionOf(file)).toBeGreaterThan(12)
  })
})

describe('step 14: a data file from schema version 13, before saved reads', () => {
  test('keeps its connection, has no saved reads, and takes one, which survives reopening', () => {
    const file = writeFile('v13.db', VERSION_13_SCHEMA, 13)
    const query = 'repo:acme/checkout is:issue milestone:"Launch"'
    const storage = openSqliteStorage(file)
    expect(storage.connection(TEAM)).toEqual({ tracker: 'github', owner: 'acme', repo: 'checkout' })
    expect(storage.savedRead({ teamId: TEAM, query })).toBeUndefined()

    const read = {
      tickets: [{ id: 'I_1', finishedAt: '2026-11-06T22:30:00Z' }, { id: 'I_2' }],
      incomplete: true,
      readAt: '2026-11-11T08:15:00Z',
      finishedSince: '2026-09-16T08:15:00Z',
    }
    storage.saveRead({ teamId: TEAM, query }, read)
    storage.close()

    const again = openSqliteStorage(file)
    expect(again.savedRead({ teamId: TEAM, query })).toEqual(read)
    again.close()
    expect(versionOf(file)).toBeGreaterThan(13)
  })
})

describe("step 15: a data file from schema version 14, before the milestone's picks and query", () => {
  test('keeps its milestone inputs unchanged, has no picks and no query, and takes them, which survive reopening', () => {
    const file = writeFile('v14.db', VERSION_14_SCHEMA, 14)
    const storage = openSqliteStorage(file)
    expect(storage.milestoneInputs(TEAM)).toEqual({
      teamId: TEAM,
      name: 'Launch',
      startDate: '2026-09-01',
      ticketsRemaining: 40,
      ambiguity: 'medium',
      cadenceDays: 14,
      paceMode: 'range',
      paceRange: { low: 4, high: 8 },
      paceCounts: [6, 9],
      paceCadenceDays: 14,
      paceWindow: { action: undefined, skippedPeriods: [] },
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    })
    expect(storage.milestoneQuery(TEAM)).toBeUndefined()

    const picked: MilestoneQuery = { picks: [{ kind: 'milestone', name: 'Launch', query: 'milestone:"Launch"' }], query: 'milestone:"Launch"' }
    storage.saveMilestoneQuery(TEAM, picked)
    storage.close()

    const again = openSqliteStorage(file)
    expect(again.milestoneQuery(TEAM)).toEqual(picked)
    again.close()
    expect(versionOf(file)).toBeGreaterThan(14)
  })
})

describe("step 16: a data file from schema version 15, before comparable work's picks and query", () => {
  test("keeps the milestone's picks and query unchanged, has no comparable work, and takes it, which survives reopening", () => {
    const file = writeFile('v15.db', VERSION_15_SCHEMA, 15)
    const storage = openSqliteStorage(file)
    const launch: MilestoneQuery = { picks: [{ kind: 'milestone', name: 'Launch', query: 'milestone:"Launch"' }], query: 'milestone:"Launch"' }
    expect(storage.milestoneQuery(TEAM)).toEqual(launch)
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()

    const comparable: MilestoneQuery = { picks: [{ kind: 'label', name: 'checkout', query: 'label:"checkout"' }], query: 'label:"checkout"' }
    storage.saveComparableWorkQuery(TEAM, comparable)
    storage.close()

    const again = openSqliteStorage(file)
    expect(again.comparableWorkQuery(TEAM)).toEqual(comparable)
    expect(again.milestoneQuery(TEAM)).toEqual(launch)
    again.close()
    expect(versionOf(file)).toBeGreaterThan(15)
  })
})
