import { describe, expect, test } from 'vitest'
import { AN_ISO_TIMESTAMP, writeFile, open, rowsOf, EDITED_RANGES } from './migrationsHarness.js'
import { TEAM, UNVERSIONED_SCHEMA, VERSION_2_SCHEMA, VERSION_4_SCHEMA, VERSION_5_SCHEMA } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

describe('step 2: a data file from schema version 1, before workflow settings', () => {
  // Version 1's tables are the unversioned schema's, recorded as version 1.
  test("keeps its data, gives each team the sample board's workflow, and opens again unchanged", () => {
    const file = writeFile('v1.db', UNVERSIONED_SCHEMA, 1)
    const workflow = 'SELECT team_id, statuses, started_status, commit_label, blocked_statuses, blocked_labels FROM workflow_settings'
    const sampleWorkflow = {
      team_id: TEAM,
      statuses:
        '[{"status":"To Do","category":"notStarted"},{"status":"In Progress","category":"started"},{"status":"Done","category":"done"},{"status":"Cancelled","category":"cancelled"}]',
      started_status: 'In Progress',
      commit_label: null,
      blocked_statuses: '[]',
      blocked_labels: '["blocked"]',
    }

    expect(
      open(file)
        .teams()
        .map((team) => team.id),
    ).toEqual([TEAM])
    expect(rowsOf(file, workflow)).toEqual([sampleWorkflow])
    expect(rowsOf(file, 'SELECT id FROM work_items ORDER BY rowid')).toEqual([{ id: 'E1' }, { id: 'S1' }])

    open(file)
    expect(rowsOf(file, workflow)).toEqual([sampleWorkflow])
  })
})

describe('step 3: a data file from schema version 2, before epic commits', () => {
  test('keeps its workflow settings and milestone, and has no epic commits', () => {
    const file = writeFile('v2.db', VERSION_2_SCHEMA, 2)

    open(file)

    expect(rowsOf(file, 'SELECT started_status FROM workflow_settings')).toEqual([{ started_status: 'Doing' }])
    expect(rowsOf(file, 'SELECT id, name FROM milestones')).toEqual([{ id: 'M1', name: 'Launch' }])
    expect(rowsOf(file, 'SELECT * FROM epic_commits')).toEqual([])
  })
})

describe('step 4: a data file from schema version 3, with spike rules', () => {
  /** Version 3's tables: version 2's, plus epic commits as #19 shipped them. Kept verbatim: it is a past release. */
  const VERSION_3_SCHEMA = `${VERSION_2_SCHEMA}
CREATE TABLE epic_commits (
  team_id TEXT NOT NULL REFERENCES teams(id), epic_id TEXT NOT NULL, committed_at TEXT NOT NULL,
  child_count_at_commit INTEGER NOT NULL, PRIMARY KEY (team_id, epic_id)
);
INSERT INTO epic_commits VALUES ('ACME', 'E1', '2026-10-02T12:00:00Z', 1);
`

  test('keeps its workflow settings and commits, and drops its spike rules', () => {
    const file = writeFile('v3.db', VERSION_3_SCHEMA, 3)

    open(file)

    expect(rowsOf(file, 'SELECT * FROM workflow_settings')).toEqual([
      {
        team_id: TEAM,
        statuses: '[{"status":"Doing","category":"started"}]',
        started_status: 'Doing',
        commit_label: null,
        blocked_statuses: '[]',
        blocked_labels: '[]',
      },
    ])
    expect(rowsOf(file, 'SELECT * FROM epic_commits')).toEqual([
      { team_id: TEAM, epic_id: 'E1', committed_at: '2026-10-02T12:00:00Z', child_count_at_commit: 1 },
    ])
  })
})

describe('step 5: a data file from schema version 4, before ambiguity', () => {
  test('has no ambiguity ranges, and takes them, and they survive reopening', () => {
    const file = writeFile('v4.db', VERSION_4_SCHEMA, 4)

    const storage = open(file)
    expect(storage.ambiguityRanges(TEAM)).toBeUndefined()

    storage.saveAmbiguityRanges(EDITED_RANGES)

    expect(open(file).ambiguityRanges(TEAM)).toEqual(EDITED_RANGES)
  })
})

describe('step 6: a data file from schema version 5, before installation dates', () => {
  test('counts its own teams from the upgrade and the sample team from its canned date, and keeps chosen measured pace', () => {
    const file = writeFile('v5.db', VERSION_5_SCHEMA, 5)
    // the upgrade records whole seconds
    const before = Math.floor(Date.now() / 1000) * 1000

    const storage = open(file)
    const after = Date.now()
    const [acme, sample] = storage.teams()
    expect(acme!.installedAt).toEqual(AN_ISO_TIMESTAMP)
    expect(Date.parse(acme!.installedAt)).toBeGreaterThanOrEqual(before)
    expect(Date.parse(acme!.installedAt)).toBeLessThanOrEqual(after)
    expect(sample).toMatchObject({ id: 'sample-team', installedAt: '2026-08-31T09:00:00Z' })

    storage.saveTeam({ ...acme!, name: 'Acme Payments', installedAt: '2030-01-01T00:00:00Z' })
    expect(open(file).teams()[0]).toEqual({ ...acme, name: 'Acme Payments' })
    expect(rowsOf(file, "SELECT mode, low, high FROM pace_settings WHERE team_id = 'sample-team'")).toEqual([{ mode: 'measured', low: null, high: null }])
  })

  test('keeps its ambiguity ranges, and editing them leaves the measured growth adopted before the MVP as it was', () => {
    const file = writeFile('v5.db', VERSION_5_SCHEMA, 5)

    const storage = open(file)
    expect(storage.ambiguityRanges(TEAM)).toEqual(EDITED_RANGES)
    storage.saveAmbiguityRanges({ ...EDITED_RANGES, medium: { low: 1, high: 3 } })

    expect(open(file).ambiguityRanges(TEAM)).toEqual({ ...EDITED_RANGES, medium: { low: 1, high: 3 } })
    expect(rowsOf(file, 'SELECT medium_measured FROM ambiguity_ranges')).toEqual([{ medium_measured: 1 }])
  })
})
