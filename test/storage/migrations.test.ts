import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { submitInputs } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { MilestoneQueryStorage, SavedReadStorage, Storage } from '../../src/storage/storage.js'

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

/** What these tests read back from a migrated file: its inputs, and the milestone's query and saved reads. */
type Opened = Storage & MilestoneQueryStorage & SavedReadStorage

const AN_ISO_TIMESTAMP = expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)

let dir: string
let storage: Opened | undefined

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

function open(file: string): Opened {
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

/**
 * The rows `sql` reads, straight from the file once storage has closed it: for the tables earlier releases wrote, which
 * the MVP no longer reads but keeps for #6's follow-on work.
 */
function rowsOf(file: string, sql: string): Record<string, unknown>[] {
  storage?.close()
  storage = undefined
  const db = new DatabaseSync(file)
  const rows = db.prepare(sql).all().map((row) => ({ ...row }))
  db.close()
  return rows
}

/** Ambiguity ranges other than the defaults, to tell them apart. */
const EDITED_RANGES = {
  teamId: TEAM,
  low: { low: 1, high: 1.25 },
  medium: { low: 1, high: 2.5 },
  high: { low: 1.5, high: 4 },
}

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
    expect(rowsOf(file, 'SELECT id, name, committed_date FROM milestones')).toEqual([
      { id: 'M1', name: 'Launch', committed_date: '2026-12-18' },
    ])
    expect(rowsOf(file, 'SELECT milestone_id, epic_id FROM milestone_epics')).toEqual([{ milestone_id: 'M1', epic_id: 'E1' }])
    expect(rowsOf(file, 'SELECT milestone_id, mode, low, high FROM pace_settings')).toEqual([
      { milestone_id: 'M1', mode: 'manual', low: 3, high: 7 },
    ])
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

    open(file).saveAmbiguityRanges(EDITED_RANGES)

    expect(versionOf(file)).toBe(version)
    const reopened = open(file)
    expect(reopened.milestoneInputs(TEAM)).toMatchObject({ name: 'Launch', paceRange: { low: 3, high: 7 } })
    expect(reopened.ambiguityRanges(TEAM)).toEqual(EDITED_RANGES)
    expect(rowsOf(file, 'SELECT id FROM work_items ORDER BY rowid')).toEqual([{ id: 'E1' }, { id: 'S1' }])
  })
})

describe('a data file from schema version 1, before workflow settings', () => {
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

    expect(open(file).teams().map((team) => team.id)).toEqual([TEAM])
    expect(rowsOf(file, workflow)).toEqual([sampleWorkflow])
    expect(rowsOf(file, 'SELECT id FROM work_items ORDER BY rowid')).toEqual([{ id: 'E1' }, { id: 'S1' }])

    open(file)
    expect(rowsOf(file, workflow)).toEqual([sampleWorkflow])
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
  test('keeps its workflow settings and milestone, and has no epic commits', () => {
    const file = writeFile('v2.db', VERSION_2_SCHEMA, 2)

    open(file)

    expect(rowsOf(file, 'SELECT started_status FROM workflow_settings')).toEqual([{ started_status: 'Doing' }])
    expect(rowsOf(file, 'SELECT id, name FROM milestones')).toEqual([{ id: 'M1', name: 'Launch' }])
    expect(rowsOf(file, 'SELECT * FROM epic_commits')).toEqual([])
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
  test('has no ambiguity ranges, and takes them, and they survive reopening', () => {
    const file = writeFile('v4.db', VERSION_4_SCHEMA, 4)

    const storage = open(file)
    expect(storage.ambiguityRanges(TEAM)).toBeUndefined()

    storage.saveAmbiguityRanges(EDITED_RANGES)

    expect(open(file).ambiguityRanges(TEAM)).toEqual(EDITED_RANGES)
  })
})

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
INSERT INTO ambiguity_ranges VALUES ('ACME', 1, 1.25, 1, 2.5, 1.5, 4, 1);
`

describe('a data file from schema version 5, before installation dates', () => {
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
    expect(rowsOf(file, "SELECT mode, low, high FROM pace_settings WHERE team_id = 'sample-team'")).toEqual([
      { mode: 'measured', low: null, high: null },
    ])
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

/** Version 6's tables: version 5's, plus installation dates as #22 shipped them. Kept verbatim: it is a past release. */
const VERSION_6_SCHEMA = `${VERSION_5_SCHEMA}
ALTER TABLE teams ADD COLUMN installed_at TEXT;
UPDATE teams SET installed_at = '2026-08-31T09:00:00Z';
INSERT INTO milestones VALUES ('ACME', 'M2', 'Later', '2027-03-01');
`

describe('a data file from schema version 6, before milestone inputs', () => {
  test("keeps each team's first milestone by name and manual pace, and leaves its start date and tickets to enter", () => {
    const file = writeFile('v6.db', VERSION_6_SCHEMA, 6)

    const storage = open(file)

    const defaults = {
      ambiguity: 'medium',
      cadenceDays: 7,
      paceMode: 'range',
      paceCounts: [],
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    }
    const left = { startDate: undefined, ticketsRemaining: undefined }
    expect(storage.milestoneInputs(TEAM)).toEqual({
      teamId: TEAM,
      name: 'Launch',
      ...left,
      ...defaults,
      paceRange: { low: 3, high: 7 },
      paceCadenceDays: 7,
      paceWindow: { action: undefined, skippedPeriods: [] },
    })
    expect(storage.milestoneInputs('sample-team')).toEqual({
      teamId: 'sample-team',
      name: 'Checkout v2',
      ...left,
      ...defaults,
      paceRange: undefined,
      paceCadenceDays: undefined,
      paceWindow: { action: undefined, skippedPeriods: [] },
    })
  })

  test('is forecast from its MVP fields once its start date and tickets are entered: its name and pace, not its epics', () => {
    const storage = open(writeFile('v6.db', VERSION_6_SCHEMA, 6))

    const entered = submitInputs(
      storage,
      TEAM,
      DEFAULT_SETTINGS,
      '2026-09-01',
      { kind: 'setMilestone', name: 'Launch', startDate: '2026-09-01', ticketsRemaining: '20' },
    )

    expect(entered).toEqual({ saved: true, next: 'inputs' })
    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, '2026-09-01')).toMatchObject({
      kind: 'forecast',
      name: 'Launch',
      ticketsRemaining: 20,
      startDate: '2026-09-01',
      pace: { source: 'range', low: 3, high: 7 },
    })
  })

  test('takes the milestone inputs, and they survive reopening', () => {
    const file = writeFile('v6.db', VERSION_6_SCHEMA, 6)
    const inputs = {
      teamId: TEAM,
      name: 'Launch',
      startDate: '2026-09-01',
      ticketsRemaining: 120,
      ticketsSource: 'typed' as const,
      ambiguity: 'high' as const,
      cadenceDays: 14,
      paceMode: 'counts' as const,
      paceRange: { low: 4, high: 8 },
      paceCounts: [6, 0, 9],
      paceCadenceDays: 7,
      paceWindow: { action: undefined, skippedPeriods: [] },
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    }

    open(file).saveMilestoneInputs(inputs)

    expect(open(file).milestoneInputs(TEAM)).toEqual(inputs)
  })
})

/** Version 7's tables: version 6's, plus milestone inputs as #85 shipped them. Kept verbatim: it is a past release. */
const VERSION_7_SCHEMA = `${VERSION_6_SCHEMA}
CREATE TABLE milestone_inputs (
team_id TEXT PRIMARY KEY REFERENCES teams(id),
name TEXT NOT NULL,
start_date TEXT,
tickets_remaining INTEGER,
ambiguity TEXT NOT NULL DEFAULT 'medium',
cadence_days INTEGER NOT NULL DEFAULT 7,
pace_mode TEXT NOT NULL DEFAULT 'range',
pace_low INTEGER,
pace_high INTEGER,
pace_counts TEXT NOT NULL DEFAULT '[]'
);
INSERT INTO milestone_inputs VALUES ('ACME', 'Launch', '2026-09-01', 40, 'medium', 14, 'range', 4, 8, '[6, 9]');
INSERT INTO milestone_inputs (team_id, name, cadence_days) VALUES ('sample-team', 'Checkout v2', 14);
`

describe('a data file from schema version 7, before the cadence the pace was entered in', () => {
  test('counts a pace already saved as entered in its cadence, so it forecasts with no warning', () => {
    const storage = open(writeFile('v7.db', VERSION_7_SCHEMA, 7))

    expect(storage.milestoneInputs(TEAM)).toMatchObject({ cadenceDays: 14, paceCadenceDays: 14 })
    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, '2026-09-01')).toMatchObject({ kind: 'forecast', warnings: [] })
  })

  test('leaves a milestone with no pace yet without one', () => {
    const storage = open(writeFile('v7.db', VERSION_7_SCHEMA, 7))

    expect(storage.milestoneInputs('sample-team')).toMatchObject({ paceRange: undefined, paceCounts: [], paceCadenceDays: undefined })
  })

  test('warns once the cadence changes after the upgrade', () => {
    const storage = open(writeFile('v7.db', VERSION_7_SCHEMA, 7))

    submitInputs(storage, TEAM, DEFAULT_SETTINGS, '2026-09-01', { kind: 'setCadence', cadenceDays: '7' })

    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, '2026-09-01')).toMatchObject({
      warnings: [{ input: 'pace', message: 'Pace: cadence length has changed. Please verify that the per period numbers are aligned.' }],
    })
  })
})

/** Version 8's tables: version 7's, plus the cadence the pace was entered in as #99 shipped it. Kept verbatim. */
const VERSION_8_SCHEMA = `${VERSION_7_SCHEMA}
ALTER TABLE milestone_inputs ADD COLUMN pace_cadence_days INTEGER;
UPDATE milestone_inputs SET pace_cadence_days = cadence_days WHERE pace_low IS NOT NULL OR pace_counts <> '[]';
`

describe('a data file from schema version 8, before capacity', () => {
  test('has no capacity entries, forecasts as before, and takes entries that survive reopening', () => {
    const file = writeFile('v8.db', VERSION_8_SCHEMA, 8)
    const storage = open(file)
    expect(storage.capacityEntries(TEAM)).toEqual([])
    expect(milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, '2026-09-01')).toMatchObject({ kind: 'forecast', warnings: [] })

    const holiday = { id: 1, from: '2026-09-07', to: '2026-09-07', percent: 0, note: 'Holiday' }
    storage.saveCapacityEntries(TEAM, [holiday])

    expect(open(file).capacityEntries(TEAM)).toEqual([holiday])
  })
})

/** Version 9's tables: version 8's, plus capacity entries as #164 shipped them. Kept verbatim: it is a past release. */
const VERSION_9_SCHEMA = `${VERSION_8_SCHEMA}
CREATE TABLE capacity_entries (
  team_id TEXT NOT NULL REFERENCES teams(id),
  id INTEGER NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT,
  percent INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (team_id, id)
);
INSERT INTO capacity_entries (team_id, id, from_date, to_date, percent, note) VALUES ('${TEAM}', 1, '2026-09-07', '2026-09-07', 0, 'Holiday');
`

describe('a data file from schema version 9, before the capacity switch', () => {
  test('keeps its capacity entries, has capacity on, and takes the switch, which survives reopening', () => {
    const file = writeFile('v9.db', VERSION_9_SCHEMA, 9)
    const storage = open(file)
    expect(storage.capacityEntries(TEAM)).toEqual([{ id: 1, from: '2026-09-07', to: '2026-09-07', percent: 0, note: 'Holiday' }])
    expect(storage.capacityOn(TEAM)).toBe(true)

    storage.saveCapacityOn(TEAM, false)

    expect(open(file).capacityOn(TEAM)).toBe(false)
  })
})

/** Version 10's tables: version 9's, plus the capacity switch as #165 shipped it. Kept verbatim: it is a past release. */
const VERSION_10_SCHEMA = `${VERSION_9_SCHEMA}
CREATE TABLE capacity_switch (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  capacity_on INTEGER NOT NULL
);
INSERT INTO capacity_entries (team_id, id, from_date, to_date, percent, note) VALUES ('${TEAM}', 2, '2026-08-03', NULL, 80, 'Two left');
`

describe('a data file from schema version 10, before the new usual', () => {
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

/** Version 11's tables: version 10's, plus the new usual as #169 shipped it. Kept verbatim: it is a past release. */
const VERSION_11_SCHEMA = `${VERSION_10_SCHEMA}
ALTER TABLE capacity_entries ADD COLUMN new_usual_on TEXT;
ALTER TABLE capacity_entries ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;
`

describe('a data file from schema version 11, before the pace window', () => {
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

/** Version 12's tables: version 11's, plus the pace window as #161 shipped it. Kept verbatim: it is a past release. */
const VERSION_12_SCHEMA = `${VERSION_11_SCHEMA}
ALTER TABLE milestone_inputs ADD COLUMN pace_window TEXT NOT NULL DEFAULT '{}';
`

describe('a data file from schema version 12, before the connection', () => {
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

/** Version 13's tables: version 12's, plus the connection as #178 shipped it. Kept verbatim: it is a past release. */
const VERSION_13_SCHEMA = `${VERSION_12_SCHEMA}
CREATE TABLE connections (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  tracker TEXT NOT NULL,
  owner TEXT,
  repo TEXT,
  site TEXT,
  project_key TEXT,
  email TEXT
);
INSERT INTO connections (team_id, tracker, owner, repo) VALUES ('${TEAM}', 'github', 'acme', 'checkout');
`

describe('a data file from schema version 13, before saved reads', () => {
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

/** Version 14's tables: version 13's, plus saved reads as #183 shipped them. Kept verbatim: it is a past release. */
const VERSION_14_SCHEMA = `${VERSION_13_SCHEMA}
CREATE TABLE saved_reads (
  team_id TEXT NOT NULL REFERENCES teams(id),
  query TEXT NOT NULL,
  incomplete INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (team_id, query)
);
CREATE TABLE saved_read_tickets (
  team_id TEXT NOT NULL,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  id TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (team_id, query, position),
  FOREIGN KEY (team_id, query) REFERENCES saved_reads(team_id, query) ON DELETE CASCADE
);
`

describe("a data file from schema version 14, before the milestone's picks and query", () => {
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

/** Version 15's tables: version 14's, plus the milestone's picks and query as #190 shipped them. Kept verbatim: it is a past release. */
const VERSION_15_SCHEMA = `${VERSION_14_SCHEMA}
CREATE TABLE milestone_queries (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  query TEXT NOT NULL,
  picks TEXT NOT NULL
);
INSERT INTO milestone_queries VALUES ('${TEAM}', 'milestone:"Launch"', '[{"kind":"milestone","name":"Launch","query":"milestone:\\"Launch\\""}]');
`

describe("a data file from schema version 15, before comparable work's picks and query", () => {
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

/** Version 16's tables: version 15's, plus comparable work's picks and query as #201 shipped them. Kept verbatim: it is a past release. */
const VERSION_16_SCHEMA = `${VERSION_15_SCHEMA}
CREATE TABLE comparable_work_queries (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  query TEXT NOT NULL,
  picks TEXT NOT NULL
);
UPDATE milestone_inputs SET pace_window = '{"action":{"kind":"leaveOut","period":"2026-08-17"}}' WHERE team_id = '${TEAM}';
`

describe("a data file from schema version 16, before the values' sources, skips and reads seen", () => {
  test.each(['range', 'counts'])(
    'keeps its milestone inputs with tickets typed, its pace mode %s unchanged, no skips and nothing seen',
    (paceMode) => {
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
    },
  )

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

/** Version 17's tables: version 16's, with the values' sources and reads seen as #210 shipped them, and a saved read. Kept verbatim: it is a past release. */
const VERSION_17_SCHEMA = `${VERSION_16_SCHEMA}
ALTER TABLE milestone_inputs ADD COLUMN tickets_source TEXT NOT NULL DEFAULT 'typed';
ALTER TABLE milestone_inputs ADD COLUMN seen_reads TEXT NOT NULL DEFAULT '{}';
INSERT INTO saved_reads VALUES ('${TEAM}', 'milestone:"Launch"', 0, '2026-10-28T09:05:00Z');
INSERT INTO saved_read_tickets VALUES ('${TEAM}', 'milestone:"Launch"', 0, 'I_1', '2026-10-27T10:00:00Z');
INSERT INTO saved_read_tickets VALUES ('${TEAM}', 'milestone:"Launch"', 1, 'I_2', NULL);
`

describe('a data file from schema version 17, before previous reads', () => {
  test('keeps its saved read with no previous read, and its next read keeps it as the previous one, which survives reopening', () => {
    const file = writeFile('v17.db', VERSION_17_SCHEMA, 17)
    const query = 'milestone:"Launch"'
    const storage = openSqliteStorage(file)
    // reaching back the 8 weeks it was read with (#213)
    const saved = { tickets: [{ id: 'I_1', finishedAt: '2026-10-27T10:00:00Z' }, { id: 'I_2' }], incomplete: false, readAt: '2026-10-28T09:05:00Z', finishedSince: '2026-09-02T09:05:00.000Z' }
    expect(storage.savedRead({ teamId: TEAM, query })).toEqual(saved)
    expect(storage.previousRead({ teamId: TEAM, query })).toBeUndefined()

    storage.saveRead({ teamId: TEAM, query }, { tickets: [{ id: 'I_2' }], incomplete: false, readAt: '2026-11-04T09:12:00Z', finishedSince: '2026-09-02T09:12:00Z' })
    storage.close()

    const again = openSqliteStorage(file)
    expect(again.previousRead({ teamId: TEAM, query })).toEqual(saved)
    again.close()
    expect(versionOf(file)).toBe(19)
  })
})

/** Version 18's tables: version 17's, plus the previous reads as #214 shipped them, and a previous read. Kept verbatim: it is a past release. */
const VERSION_18_SCHEMA = `${VERSION_17_SCHEMA}
CREATE TABLE previous_reads (
  team_id TEXT NOT NULL REFERENCES teams(id),
  query TEXT NOT NULL,
  incomplete INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (team_id, query)
);
CREATE TABLE previous_read_tickets (
  team_id TEXT NOT NULL,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  id TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (team_id, query, position),
  FOREIGN KEY (team_id, query) REFERENCES previous_reads(team_id, query) ON DELETE CASCADE
);
INSERT INTO previous_reads VALUES ('${TEAM}', 'milestone:"Launch"', 0, '2026-10-21T09:00:00Z');
INSERT INTO previous_read_tickets VALUES ('${TEAM}', 'milestone:"Launch"', 0, 'I_1', NULL);
`

describe('a data file from schema version 18, before reads reached back past skipped periods', () => {
  test('keeps its saved and previous reads, each reaching back the 8 weeks it was read with', () => {
    const file = writeFile('v18.db', VERSION_18_SCHEMA, 18)
    const storage = open(file)

    expect(storage.savedRead({ teamId: TEAM, query: 'milestone:"Launch"' })).toMatchObject({ readAt: '2026-10-28T09:05:00Z', finishedSince: '2026-09-02T09:05:00.000Z' })
    expect(storage.previousRead({ teamId: TEAM, query: 'milestone:"Launch"' })).toEqual({
      tickets: [{ id: 'I_1' }],
      incomplete: false,
      readAt: '2026-10-21T09:00:00Z',
      finishedSince: '2026-08-26T09:00:00.000Z',
    })
  })

  test('takes a read reaching further back, which survives reopening', () => {
    const file = writeFile('v18.db', VERSION_18_SCHEMA, 18)
    const read = { tickets: [{ id: 'I_2', finishedAt: '2026-09-15T10:00:00Z' }], incomplete: false, readAt: '2026-11-13T09:00:00Z', finishedSince: '2026-08-27T09:00:00Z' }
    open(file).saveRead({ teamId: TEAM, query: 'milestone:"Launch"' }, read)

    expect(open(file).savedRead({ teamId: TEAM, query: 'milestone:"Launch"' })).toEqual(read)
    expect(versionOf(file)).toBe(19)
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
