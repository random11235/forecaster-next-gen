import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { WorkItem } from '../../src/model/workItem.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

const TEAM = 'ACME'
const CREATED = '2026-09-01T09:00:00Z'

/** The schema as shipped by #16 and #17, before the file recorded a version. Kept verbatim: it is a past release. */
const UNVERSIONED_SCHEMA = `
CREATE TABLE teams (id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT NOT NULL);
CREATE TABLE work_items (
  team_id TEXT NOT NULL REFERENCES teams(id), id TEXT NOT NULL, source_key TEXT NOT NULL, type TEXT NOT NULL,
  title TEXT, parent_id TEXT, labels TEXT NOT NULL, created_at TEXT NOT NULL, started_at TEXT, done_at TEXT,
  cancelled_at TEXT, last_synced_at TEXT NOT NULL, PRIMARY KEY (team_id, id)
);
CREATE TABLE work_item_events (
  team_id TEXT NOT NULL, item_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, from_value TEXT, to_value TEXT,
  FOREIGN KEY (team_id, item_id) REFERENCES work_items(team_id, id)
);
CREATE INDEX work_item_events_team ON work_item_events(team_id);
CREATE TABLE milestones (
  team_id TEXT NOT NULL REFERENCES teams(id), id TEXT NOT NULL, name TEXT NOT NULL, committed_date TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE milestone_epics (
  team_id TEXT NOT NULL, milestone_id TEXT NOT NULL, rank INTEGER NOT NULL, epic_id TEXT NOT NULL,
  PRIMARY KEY (team_id, milestone_id, rank), FOREIGN KEY (team_id, milestone_id) REFERENCES milestones(team_id, id)
);
CREATE TABLE pace_settings (
  team_id TEXT NOT NULL, milestone_id TEXT NOT NULL, mode TEXT NOT NULL, low INTEGER, high INTEGER,
  PRIMARY KEY (team_id, milestone_id), FOREIGN KEY (team_id, milestone_id) REFERENCES milestones(team_id, id)
);
INSERT INTO teams VALUES ('ACME', 'Acme', 'jira', 'ACME');
INSERT INTO work_items VALUES
  ('ACME', 'E1', 'ACME-1', 'epic', 'Checkout', NULL, '[]', '${CREATED}', NULL, NULL, NULL, '${CREATED}'),
  ('ACME', 'S1', 'ACME-2', 'story', NULL, 'E1', '["web"]', '${CREATED}', '2026-09-02T09:00:00Z', NULL, NULL, '${CREATED}');
INSERT INTO work_item_events VALUES ('ACME', 'S1', '2026-09-02T09:00:00Z', 'status', 'To Do', 'In Progress');
INSERT INTO milestones VALUES ('ACME', 'M1', 'Launch', '2026-12-18');
INSERT INTO milestone_epics VALUES ('ACME', 'M1', 0, 'E1');
INSERT INTO pace_settings VALUES ('ACME', 'M1', 'manual', 3, 7);
`

const AN_ISO_TIMESTAMP = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)

let dir: string
let storage: Storage | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-migrations-'))
})

afterEach(() => {
  storage?.close()
  storage = undefined
  rmSync(dir, { recursive: true, force: true })
})

/** Writes a data file the way an earlier release left it: `sql` run against a new file, at `version`. */
function writeFile(name: string, sql: string, version = 0): string {
  const file = join(dir, name)
  const db = new DatabaseSync(file)
  db.exec(sql)
  db.exec(`PRAGMA user_version = ${version}`)
  db.close()
  return file
}

function open(file: string): Storage {
  storage?.close()
  storage = openSqliteStorage(file)
  return storage
}

/** The schema version the file records, read straight from the file once storage has closed it. */
function versionOf(file: string): number {
  storage?.close()
  storage = undefined
  const db = new DatabaseSync(file)
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  db.close()
  return user_version
}

/** Each table's columns and indexes, as SQLite reports them, so files built by different routes can be compared. */
function schemaOf(file: string): Record<string, unknown> {
  const db = new DatabaseSync(file)
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
  const schema = Object.fromEntries(
    tables.map(({ name }) => [
      String(name),
      {
        columns: db.prepare(`PRAGMA table_info(${String(name)})`).all(),
        indexes: db.prepare(`PRAGMA index_list(${String(name)})`).all(),
        foreignKeys: db.prepare(`PRAGMA foreign_key_list(${String(name)})`).all(),
      },
    ]),
  )
  db.close()
  return schema
}

function ticket(id: string, fields: Partial<WorkItem> = {}): WorkItem {
  return { id, teamId: TEAM, sourceKey: id, type: 'story', labels: [], createdAt: CREATED, lastSyncedAt: CREATED, ...fields }
}

describe('a data file written before schema versions', () => {
  test('opens and keeps its team, facts, milestone and pace setting', () => {
    const storage = open(writeFile('old.db', UNVERSIONED_SCHEMA))

    expect(storage.teams()).toEqual([{ id: TEAM, name: 'Acme', source: 'jira', sourceRef: TEAM, installedAt: AN_ISO_TIMESTAMP }])
    expect(storage.facts(TEAM)).toEqual({
      workItems: [
        { id: 'E1', teamId: TEAM, sourceKey: 'ACME-1', type: 'epic', title: 'Checkout', labels: [], createdAt: CREATED, lastSyncedAt: CREATED },
        {
          id: 'S1',
          teamId: TEAM,
          sourceKey: 'ACME-2',
          type: 'story',
          parentId: 'E1',
          labels: ['web'],
          createdAt: CREATED,
          startedAt: '2026-09-02T09:00:00Z',
          lastSyncedAt: CREATED,
        },
      ],
      events: [{ itemId: 'S1', at: '2026-09-02T09:00:00Z', kind: 'status', from: 'To Do', to: 'In Progress' }],
    })
    expect(storage.milestones(TEAM)).toEqual([
      { id: 'M1', teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] },
    ])
    expect(storage.paceSetting(TEAM, 'M1')).toEqual({ teamId: TEAM, milestoneId: 'M1', mode: 'manual', manual: { low: 3, high: 7 } })
  })
})

describe('schema version', () => {
  test('a fresh file and an upgraded file record the same version, above the unversioned one', () => {
    const fresh = join(dir, 'fresh.db')
    open(fresh)
    const old = writeFile('old.db', UNVERSIONED_SCHEMA)
    open(old)

    expect(versionOf(fresh)).toBeGreaterThan(0)
    expect(versionOf(old)).toBe(versionOf(fresh))
  })

  test('a fresh file and an upgraded file end up with the same tables, columns and indexes', () => {
    const fresh = join(dir, 'fresh.db')
    open(fresh)
    const old = writeFile('old.db', UNVERSIONED_SCHEMA)
    open(old)
    storage?.close()
    storage = undefined

    expect(schemaOf(old)).toEqual(schemaOf(fresh))
  })

  test('an upgraded file opens again unchanged in version and content, and takes new data', () => {
    const file = writeFile('old.db', UNVERSIONED_SCHEMA)
    open(file)
    const version = versionOf(file)

    const storage = open(file)
    storage.addFacts(TEAM, { workItems: [ticket('S2')], events: [] })
    storage.savePaceSetting({ teamId: TEAM, milestoneId: 'M1', mode: 'measured', manual: { low: 3, high: 7 } })

    expect(versionOf(file)).toBe(version)
    const reopened = open(file)
    expect(reopened.facts(TEAM).workItems.map((item) => item.id)).toEqual(['E1', 'S1', 'S2'])
    expect(reopened.paceSetting(TEAM, 'M1')).toEqual({ teamId: TEAM, milestoneId: 'M1', mode: 'measured', manual: { low: 3, high: 7 } })
  })
})

describe('a data file from schema version 1, before workflow settings', () => {
  // Version 1's tables are the unversioned schema's, recorded as version 1.
  const SAMPLE_WORKFLOW = {
    teamId: TEAM,
    statuses: [
      { status: 'To Do', category: 'notStarted' },
      { status: 'In Progress', category: 'started' },
      { status: 'Done', category: 'done' },
      { status: 'Cancelled', category: 'cancelled' },
    ],
    startedStatus: 'In Progress',
    blockedRule: { statuses: [], labels: ['blocked'] },
  }

  test("keeps its data, gives each team the sample board's workflow, and opens again unchanged", () => {
    const file = writeFile('v1.db', UNVERSIONED_SCHEMA, 1)

    const storage = open(file)
    expect(storage.teams()).toEqual([{ id: TEAM, name: 'Acme', source: 'jira', sourceRef: TEAM, installedAt: AN_ISO_TIMESTAMP }])
    expect(storage.facts(TEAM).workItems.map((item) => item.id)).toEqual(['E1', 'S1'])
    expect(storage.milestones(TEAM)).toEqual([
      { id: 'M1', teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] },
    ])
    expect(storage.paceSetting(TEAM, 'M1')).toEqual({ teamId: TEAM, milestoneId: 'M1', mode: 'manual', manual: { low: 3, high: 7 } })
    expect(storage.workflowSettings(TEAM)).toEqual(SAMPLE_WORKFLOW)

    const reopened = open(file)
    expect(reopened.workflowSettings(TEAM)).toEqual(SAMPLE_WORKFLOW)
    expect(reopened.facts(TEAM).workItems.map((item) => item.id)).toEqual(['E1', 'S1'])
  })

  test('takes new workflow settings, and they survive reopening', () => {
    const file = writeFile('v1.db', UNVERSIONED_SCHEMA, 1)
    const changed = { ...SAMPLE_WORKFLOW, startedStatus: 'Doing', commitLabel: 'committed' }

    open(file).saveWorkflowSettings({ ...changed, statuses: [{ status: 'Doing', category: 'started' }] })

    expect(open(file).workflowSettings(TEAM)).toEqual({ ...changed, statuses: [{ status: 'Doing', category: 'started' }] })
  })
})

/** Version 2's tables: version 1's, plus workflow settings as #18 shipped them. Kept verbatim: it is a past release. */
const VERSION_2_SCHEMA = `${UNVERSIONED_SCHEMA}
CREATE TABLE workflow_settings (
  team_id TEXT PRIMARY KEY REFERENCES teams(id), statuses TEXT NOT NULL, started_status TEXT NOT NULL,
  spike_types TEXT NOT NULL, spike_labels TEXT NOT NULL, commit_label TEXT, blocked_statuses TEXT NOT NULL,
  blocked_labels TEXT NOT NULL
);
INSERT INTO workflow_settings VALUES ('ACME', '[{"status":"Doing","category":"started"}]', 'Doing', '[]', '[]', NULL, '[]', '[]');
`

describe('a data file from schema version 2, before epic commits', () => {
  test('keeps its data, has no epic commits, and takes one that survives reopening', () => {
    const file = writeFile('v2.db', VERSION_2_SCHEMA, 2)

    const storage = open(file)
    expect(storage.workflowSettings(TEAM)).toMatchObject({ startedStatus: 'Doing' })
    expect(storage.milestones(TEAM)).toEqual([
      { id: 'M1', teamId: TEAM, name: 'Launch', committedDate: '2026-12-18', epicIds: ['E1'] },
    ])
    expect(storage.epicCommits(TEAM)).toEqual([])

    const commit = { teamId: TEAM, epicId: 'E1', committedAt: '2026-10-02T12:00:00Z', baseline: 1 }
    storage.saveEpicCommit(commit)

    expect(open(file).epicCommits(TEAM)).toEqual([commit])
  })
})

describe('a data file from schema version 3, with spike rules', () => {
  /** Version 3's tables: version 2's, plus epic commits as #19 shipped them. Kept verbatim: it is a past release. */
  const VERSION_3_SCHEMA = `${VERSION_2_SCHEMA}
CREATE TABLE epic_commits (
  team_id TEXT NOT NULL REFERENCES teams(id), epic_id TEXT NOT NULL, committed_at TEXT NOT NULL,
  child_count_at_commit INTEGER NOT NULL, PRIMARY KEY (team_id, epic_id)
);
INSERT INTO epic_commits VALUES ('ACME', 'E1', '2026-10-02T12:00:00Z', 1);
`

  test('keeps its workflow settings and commits, drops its spike rules, and takes new settings', () => {
    const file = writeFile('v3.db', VERSION_3_SCHEMA, 3)

    const storage = open(file)
    expect(storage.workflowSettings(TEAM)).toEqual({
      teamId: TEAM,
      statuses: [{ status: 'Doing', category: 'started' }],
      startedStatus: 'Doing',
      blockedRule: { statuses: [], labels: [] },
    })
    expect(storage.epicCommits(TEAM)).toEqual([{ teamId: TEAM, epicId: 'E1', committedAt: '2026-10-02T12:00:00Z', baseline: 1 }])

    const changed = {
      teamId: TEAM,
      statuses: [{ status: 'Doing', category: 'started' as const }],
      startedStatus: 'Doing',
      commitLabel: 'committed',
      blockedRule: { statuses: [], labels: ['blocked'] },
    }
    storage.saveWorkflowSettings(changed)

    expect(open(file).workflowSettings(TEAM)).toEqual(changed)
  })
})

/** Version 4's tables: version 3's, less its spike rules. Kept verbatim: it is a past release. */
const VERSION_4_SCHEMA = `${VERSION_2_SCHEMA}
ALTER TABLE workflow_settings DROP COLUMN spike_types;
ALTER TABLE workflow_settings DROP COLUMN spike_labels;
CREATE TABLE epic_commits (
  team_id TEXT NOT NULL REFERENCES teams(id), epic_id TEXT NOT NULL, committed_at TEXT NOT NULL,
  child_count_at_commit INTEGER NOT NULL, PRIMARY KEY (team_id, epic_id)
);
`

describe('a data file from schema version 4, before ambiguity', () => {

  test('has no ambiguity ranges or epic levels, and takes them, and they survive reopening', () => {
    const file = writeFile('v4.db', VERSION_4_SCHEMA, 4)

    const storage = open(file)
    expect(storage.ambiguityRanges(TEAM)).toBeUndefined()
    expect(storage.epicAmbiguities(TEAM, 'M1')).toEqual([])

    const ranges = {
      teamId: TEAM,
      low: { low: 1, high: 1.25 },
      medium: { low: 1, high: 2.5 },
      high: { low: 1.5, high: 4 },
      mediumMeasured: true,
    }
    const level = { teamId: TEAM, milestoneId: 'M1', epicId: 'E1', ambiguity: 'high' as const }
    storage.saveAmbiguityRanges(ranges)
    storage.saveEpicAmbiguity(level)

    const reopened = open(file)
    expect(reopened.ambiguityRanges(TEAM)).toEqual(ranges)
    expect(reopened.epicAmbiguities(TEAM, 'M1')).toEqual([level])
  })
})

describe('a data file from schema version 5, before installation dates', () => {
  /** Version 5's tables: version 4's, plus ambiguity as #21 shipped it. Kept verbatim: it is a past release. */
  const VERSION_5_SCHEMA = `${VERSION_4_SCHEMA}
CREATE TABLE ambiguity_ranges (
  team_id TEXT PRIMARY KEY REFERENCES teams(id), low_low REAL NOT NULL, low_high REAL NOT NULL, medium_low REAL NOT NULL,
  medium_high REAL NOT NULL, high_low REAL NOT NULL, high_high REAL NOT NULL, medium_measured INTEGER NOT NULL
);
CREATE TABLE epic_ambiguities (
  team_id TEXT NOT NULL, milestone_id TEXT NOT NULL, epic_id TEXT NOT NULL, ambiguity TEXT NOT NULL,
  PRIMARY KEY (team_id, milestone_id, epic_id), FOREIGN KEY (team_id, milestone_id) REFERENCES milestones(team_id, id)
);
INSERT INTO teams VALUES ('sample-team', 'Payments (sample)', 'sample', 'PAY');
INSERT INTO milestones VALUES ('sample-team', 'sample-milestone', 'Checkout v2', '2026-12-18');
INSERT INTO pace_settings VALUES ('sample-team', 'sample-milestone', 'measured', NULL, NULL);
`

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
    expect(storage.paceSetting('sample-team', 'sample-milestone')).toEqual({
      teamId: 'sample-team',
      milestoneId: 'sample-milestone',
      mode: 'measured',
      manual: undefined,
    })

    storage.saveTeam({ ...acme!, name: 'Acme Payments', installedAt: '2030-01-01T00:00:00Z' })
    expect(open(file).teams()[0]).toEqual({ ...acme, name: 'Acme Payments' })
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
