import { describe, expect, test } from 'vitest'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import { writeFile, open, versionOf } from './migrationsHarness.js'
import { TEAM, VERSION_16_SCHEMA, VERSION_17_SCHEMA, VERSION_18_SCHEMA, VERSION_19_SCHEMA } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

describe("step 17: a data file from schema version 16, before the values' sources, skips and reads seen", () => {
  test.each(['range', 'counts'])('keeps its milestone inputs with tickets typed, its pace mode %s unchanged, no skips and nothing seen', (paceMode) => {
    const file = writeFile('v16.db', `${VERSION_16_SCHEMA}\nUPDATE milestone_inputs SET pace_mode = '${paceMode}';`, 16)
    const storage = open(file)

    expect(storage.milestoneInputs(TEAM)).toEqual({
      teamId: TEAM,
      name: 'Launch',
      startDate: '2026-09-01',
      ticketsRemaining: 40,
      ticketsSource: 'typed',
      ambiguity: 'medium',
      cadenceDays: 14,
      paceMode,
      paceRange: { low: 4, high: 8 },
      paceCounts: [6, 9],
      paceCadenceDays: 14,
      paceWindow: { action: { kind: 'leaveOut', period: '2026-08-17' }, skippedPeriods: [] },
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    })
  })

  test('takes sources, skips and reads seen, which survive reopening', () => {
    const file = writeFile('v16.db', VERSION_16_SCHEMA, 16)
    const storage = open(file)
    const following = {
      ...storage.milestoneInputs(TEAM)!,
      ticketsSource: 'tracker' as const,
      paceMode: 'tracker' as const,
      paceWindow: { action: undefined, skippedPeriods: ['2026-12-21'] },
      seenReads: { ticketsRemaining: '2026-10-28T09:05:00Z', pace: '2026-10-28T09:05:00Z' },
    }
    storage.saveMilestoneInputs(following)

    expect(open(file).milestoneInputs(TEAM)).toEqual(following)
    expect(versionOf(file)).toBeGreaterThan(16)
  })
})

describe('step 18: a data file from schema version 17, before previous reads', () => {
  test('keeps its saved read with no previous read, and its next read keeps it as the previous one, which survives reopening', () => {
    const file = writeFile('v17.db', VERSION_17_SCHEMA, 17)
    const query = 'milestone:"Launch"'
    const storage = openSqliteStorage(file)
    // reaching back the 8 weeks it was read with (#213)
    const saved = {
      tickets: [{ id: 'I_1', finishedAt: '2026-10-27T10:00:00Z' }, { id: 'I_2' }],
      incomplete: false,
      readAt: '2026-10-28T09:05:00Z',
      finishedSince: '2026-09-02T09:05:00.000Z',
    }
    expect(storage.savedRead({ teamId: TEAM, query })).toEqual(saved)
    expect(storage.previousRead({ teamId: TEAM, query })).toBeUndefined()

    storage.saveRead(
      { teamId: TEAM, query },
      { tickets: [{ id: 'I_2' }], incomplete: false, readAt: '2026-11-04T09:12:00Z', finishedSince: '2026-09-02T09:12:00Z' },
    )
    storage.close()

    const again = openSqliteStorage(file)
    expect(again.previousRead({ teamId: TEAM, query })).toEqual(saved)
    again.close()
    expect(versionOf(file)).toBe(20)
  })
})

describe('step 19: a data file from schema version 18, before reads reached back past skipped periods', () => {
  test('keeps its saved and previous reads, each reaching back the 8 weeks it was read with', () => {
    const file = writeFile('v18.db', VERSION_18_SCHEMA, 18)
    const storage = open(file)

    expect(storage.savedRead({ teamId: TEAM, query: 'milestone:"Launch"' })).toMatchObject({
      readAt: '2026-10-28T09:05:00Z',
      finishedSince: '2026-09-02T09:05:00.000Z',
    })
    expect(storage.previousRead({ teamId: TEAM, query: 'milestone:"Launch"' })).toEqual({
      tickets: [{ id: 'I_1' }],
      incomplete: false,
      readAt: '2026-10-21T09:00:00Z',
      finishedSince: '2026-08-26T09:00:00.000Z',
    })
  })

  test('takes a read reaching further back, which survives reopening', () => {
    const file = writeFile('v18.db', VERSION_18_SCHEMA, 18)
    const read = {
      tickets: [{ id: 'I_2', finishedAt: '2026-09-15T10:00:00Z' }],
      incomplete: false,
      readAt: '2026-11-13T09:00:00Z',
      finishedSince: '2026-08-27T09:00:00Z',
    }
    open(file).saveRead({ teamId: TEAM, query: 'milestone:"Launch"' }, read)

    expect(open(file).savedRead({ teamId: TEAM, query: 'milestone:"Launch"' })).toEqual(read)
    expect(versionOf(file)).toBe(20)
  })
})

describe('step 20: a data file from schema version 19, before setup', () => {
  // ACME is connected with a milestone query; EMPTY connected with its query emptied; BARE connected with none; the sample team not connected
  const file = (): string =>
    writeFile(
      'v19.db',
      `${VERSION_19_SCHEMA}
INSERT INTO teams (id, name, source, source_ref) VALUES ('EMPTY', 'Empty', 'manual', ''), ('BARE', 'Bare', 'manual', '');
INSERT INTO connections (team_id, tracker, owner, repo) VALUES ('EMPTY', 'github', 'acme', 'empty'), ('BARE', 'github', 'acme', 'bare');
INSERT INTO milestone_queries VALUES ('EMPTY', '', '[]');
`,
      19,
    )

  test('has setup done for a team connected with a milestone query, and open in a first setup that made no connection for every other team', () => {
    const storage = open(file())

    expect(storage.setupState(TEAM)).toStrictEqual({ open: false, closed: 'done' })
    // a connection from before setup is none setup made, so Cancel keeps it
    expect(storage.setupState('EMPTY')).toStrictEqual({ open: true })
    expect(storage.setupState('BARE')).toStrictEqual({ open: true })
    expect(storage.setupState('sample-team')).toStrictEqual({ open: true })
  })

  test('has no setup draft and no failed reads, and takes them, with where setup stands, which survive reopening', () => {
    const migrated = file()
    const read = {
      tickets: [{ id: 'I_9', finishedAt: '2026-11-10T10:00:00Z' }],
      incomplete: false,
      readAt: '2026-11-12T09:00:00Z',
      finishedSince: '2026-09-17T09:00:00Z',
    }
    const draft = { milestoneQuery: { picks: [], query: 'label:"beta"' }, reads: [{ query: 'label:"beta"', read }], sources: { pace: 'tracker' as const } }
    const failures = { whole: { failure: 'unavailable' as const, at: '2026-11-12T09:00:00Z' } }
    expect(open(migrated).setupDraft(TEAM)).toBeUndefined()
    expect(open(migrated).readFailures(TEAM)).toBeUndefined()

    open(migrated).saveSetupState(TEAM, { open: true, reopened: 'done' })
    open(migrated).saveSetupDraft(TEAM, draft)
    open(migrated).saveReadFailures(TEAM, failures)

    expect(open(migrated).setupState(TEAM)).toStrictEqual({ open: true, reopened: 'done' })
    expect(open(migrated).setupDraft(TEAM)).toStrictEqual(draft)
    expect(open(migrated).readFailures(TEAM)).toStrictEqual(failures)
    expect(versionOf(migrated)).toBe(20)
  })
})
