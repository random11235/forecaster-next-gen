import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Ambiguity, AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import type { MilestoneInputs, PaceMode } from '../model/milestoneInputs.js'
import type { Team } from '../model/team.js'
import type { Storage } from './storage.js'

/**
 * The schema, as the steps that build it. The file records how many it has applied (`PRAGMA user_version`), and
 * opening it applies the rest in order. Steps are released history: never edit one, append a new one.
 * Every table carries team_id, so every query can be scoped by team.
 */
const MIGRATIONS: readonly string[] = [
  // 1: the schema shipped before files recorded a version. `IF NOT EXISTS` lets it adopt those files as they are.
  `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_items (
  team_id TEXT NOT NULL REFERENCES teams(id),
  id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  parent_id TEXT,
  labels TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  done_at TEXT,
  cancelled_at TEXT,
  last_synced_at TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE IF NOT EXISTS work_item_events (
  team_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT,
  FOREIGN KEY (team_id, item_id) REFERENCES work_items(team_id, id)
);
CREATE INDEX IF NOT EXISTS work_item_events_team ON work_item_events(team_id);
CREATE TABLE IF NOT EXISTS milestones (
  team_id TEXT NOT NULL REFERENCES teams(id),
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  committed_date TEXT NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE TABLE IF NOT EXISTS milestone_epics (
  team_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  epic_id TEXT NOT NULL,
  PRIMARY KEY (team_id, milestone_id, rank),
  FOREIGN KEY (team_id, milestone_id) REFERENCES milestones(team_id, id)
);
CREATE TABLE IF NOT EXISTS pace_settings (
  team_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  low INTEGER,
  high INTEGER,
  PRIMARY KEY (team_id, milestone_id),
  FOREIGN KEY (team_id, milestone_id) REFERENCES milestones(team_id, id)
);
`,
  // 2: each team's workflow settings (#18). Teams already stored get the sample board's workflow.
  // Lists are JSON arrays, as work_items.labels is.
  `
CREATE TABLE workflow_settings (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  statuses TEXT NOT NULL,
  started_status TEXT NOT NULL,
  spike_types TEXT NOT NULL,
  spike_labels TEXT NOT NULL,
  commit_label TEXT,
  blocked_statuses TEXT NOT NULL,
  blocked_labels TEXT NOT NULL
);
INSERT INTO workflow_settings (team_id, statuses, started_status, spike_types, spike_labels, commit_label, blocked_statuses, blocked_labels)
SELECT id,
  '[{"status":"To Do","category":"notStarted"},{"status":"In Progress","category":"started"},{"status":"Done","category":"done"},{"status":"Cancelled","category":"cancelled"}]',
  'In Progress', '["spike"]', '["spike"]', NULL, '[]', '["blocked"]'
FROM teams;
`,
  // 3: the EM's epic commits (#19), the latest per epic.
  `
CREATE TABLE epic_commits (
  team_id TEXT NOT NULL REFERENCES teams(id),
  epic_id TEXT NOT NULL,
  committed_at TEXT NOT NULL,
  child_count_at_commit INTEGER NOT NULL,
  PRIMARY KEY (team_id, epic_id)
);
`,
  // 4: spike rules are dropped (ADR-0002): nothing read them.
  `
ALTER TABLE workflow_settings DROP COLUMN spike_types;
ALTER TABLE workflow_settings DROP COLUMN spike_labels;
`,
  // 5: each team's ambiguity ranges, and the EM's ambiguity level for a milestone's epics (#21).
  `
CREATE TABLE ambiguity_ranges (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  low_low REAL NOT NULL,
  low_high REAL NOT NULL,
  medium_low REAL NOT NULL,
  medium_high REAL NOT NULL,
  high_low REAL NOT NULL,
  high_high REAL NOT NULL,
  medium_measured INTEGER NOT NULL
);
CREATE TABLE epic_ambiguities (
  team_id TEXT NOT NULL,
  milestone_id TEXT NOT NULL,
  epic_id TEXT NOT NULL,
  ambiguity TEXT NOT NULL,
  PRIMARY KEY (team_id, milestone_id, epic_id),
  FOREIGN KEY (team_id, milestone_id) REFERENCES milestones(team_id, id)
);
`,
  // 6: when the Forecaster was installed for each team (#22): nothing finished before it counts towards measured pace.
  // Teams already stored count from this upgrade, so no older pace is used; the sample team from when its canned
  // epics were created, as the sample data had it.
  `
ALTER TABLE teams ADD COLUMN installed_at TEXT;
UPDATE teams SET installed_at = CASE source
  WHEN 'sample' THEN '2026-08-31T09:00:00Z'
  ELSE strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
END;
`,
  // 7: the milestone's inputs, one milestone per team (#85): everything the EM enters, with its default. A team that had milestones
  // keeps its first one's name and manual pace range; its start date and tickets remaining are left for the EM.
  `
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
INSERT INTO milestone_inputs (team_id, name, pace_low, pace_high)
SELECT m.team_id, m.name, p.low, p.high
FROM milestones m
LEFT JOIN pace_settings p ON p.team_id = m.team_id AND p.milestone_id = m.id
WHERE m.rowid = (SELECT MIN(first.rowid) FROM milestones first WHERE first.team_id = m.team_id);
`,
  // 8: the cadence the pace was entered in (#115), so changing the cadence warns. A pace already stored counts as
  // entered in the cadence it has now, so upgrading warns of nothing.
  `
ALTER TABLE milestone_inputs ADD COLUMN pace_cadence_days INTEGER;
UPDATE milestone_inputs SET pace_cadence_days = cadence_days WHERE pace_low IS NOT NULL OR pace_counts <> '[]';
`,
  // 9: each team's capacity entries (#164). An entry running onward has no to_date. A file from before has none.
  `
CREATE TABLE capacity_entries (
  team_id TEXT NOT NULL REFERENCES teams(id),
  id INTEGER NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT,
  percent INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (team_id, id)
);
`,
  // 10: whether each team's capacity is switched on (#165). A team with no row has it on, as every team in a file from before does.
  `
CREATE TABLE capacity_switch (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  capacity_on INTEGER NOT NULL
);
`,
]

type Row = Record<string, SQLInputValue>

/** Opens (creating if needed) the SQLite file at `file`. `':memory:'` keeps everything in memory. */
export function openSqliteStorage(file: string): Storage {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)

  function transaction(work: () => void): void {
    db.exec('BEGIN')
    try {
      work()
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  db.exec('PRAGMA foreign_keys = ON')
  migrate(db, file, transaction)

  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, name, source, source_ref, installed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, source = excluded.source, source_ref = excluded.source_ref`)
  const upsertMilestoneInputs = db.prepare(`
    INSERT INTO milestone_inputs
      (team_id, name, start_date, tickets_remaining, ambiguity, cadence_days, pace_mode, pace_low, pace_high, pace_counts,
       pace_cadence_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      name = excluded.name, start_date = excluded.start_date, tickets_remaining = excluded.tickets_remaining,
      ambiguity = excluded.ambiguity, cadence_days = excluded.cadence_days, pace_mode = excluded.pace_mode,
      pace_low = excluded.pace_low, pace_high = excluded.pace_high, pace_counts = excluded.pace_counts,
      pace_cadence_days = excluded.pace_cadence_days`)
  const selectMilestoneInputs = db.prepare('SELECT * FROM milestone_inputs WHERE team_id = ?')
  // medium_measured is left as it is: nothing reads it since measured growth went with the MVP (#84)
  const upsertAmbiguityRanges = db.prepare(`
    INSERT INTO ambiguity_ranges (team_id, low_low, low_high, medium_low, medium_high, high_low, high_high, medium_measured)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT (team_id) DO UPDATE SET
      low_low = excluded.low_low, low_high = excluded.low_high, medium_low = excluded.medium_low,
      medium_high = excluded.medium_high, high_low = excluded.high_low, high_high = excluded.high_high`)
  const selectAmbiguityRanges = db.prepare('SELECT * FROM ambiguity_ranges WHERE team_id = ?')
  const deleteCapacityEntries = db.prepare('DELETE FROM capacity_entries WHERE team_id = ?')
  const insertCapacityEntry = db.prepare(
    'INSERT INTO capacity_entries (team_id, id, from_date, to_date, percent, note) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const selectCapacityEntries = db.prepare('SELECT * FROM capacity_entries WHERE team_id = ? ORDER BY rowid')
  const upsertCapacitySwitch = db.prepare(
    'INSERT INTO capacity_switch (team_id, capacity_on) VALUES (?, ?) ON CONFLICT (team_id) DO UPDATE SET capacity_on = excluded.capacity_on',
  )
  const selectCapacitySwitch = db.prepare('SELECT capacity_on FROM capacity_switch WHERE team_id = ?')

  return {
    isEmpty() {
      return db.prepare('SELECT 1 FROM teams LIMIT 1').get() === undefined
    },

    saveTeam(team) {
      upsertTeam.run(team.id, team.name, team.source, team.sourceRef, team.installedAt)
    },

    teams() {
      return db
        .prepare('SELECT id, name, source, source_ref, installed_at FROM teams ORDER BY rowid')
        .all()
        .map((row: Row) => ({
          id: String(row.id),
          name: String(row.name),
          source: String(row.source) as Team['source'],
          sourceRef: String(row.source_ref),
          installedAt: String(row.installed_at),
        }))
    },

    saveMilestoneInputs(inputs) {
      upsertMilestoneInputs.run(
        inputs.teamId,
        inputs.name,
        inputs.startDate ?? null,
        inputs.ticketsRemaining ?? null,
        inputs.ambiguity,
        inputs.cadenceDays,
        inputs.paceMode,
        inputs.paceRange?.low ?? null,
        inputs.paceRange?.high ?? null,
        JSON.stringify(inputs.paceCounts),
        inputs.paceCadenceDays ?? null,
      )
    },

    milestoneInputs(teamId) {
      const row = selectMilestoneInputs.get(teamId)
      if (row === undefined) return undefined
      return {
        teamId: String(row.team_id),
        name: String(row.name),
        startDate: row.start_date === null ? undefined : String(row.start_date),
        ticketsRemaining: row.tickets_remaining === null ? undefined : Number(row.tickets_remaining),
        ambiguity: String(row.ambiguity) as Ambiguity,
        cadenceDays: Number(row.cadence_days),
        paceMode: String(row.pace_mode) as PaceMode,
        paceRange: row.pace_low === null ? undefined : { low: Number(row.pace_low), high: Number(row.pace_high) },
        paceCounts: JSON.parse(String(row.pace_counts)) as number[],
        paceCadenceDays: row.pace_cadence_days === null ? undefined : Number(row.pace_cadence_days),
      } satisfies MilestoneInputs
    },

    saveAmbiguityRanges(ranges) {
      upsertAmbiguityRanges.run(
        ranges.teamId,
        ranges.low.low,
        ranges.low.high,
        ranges.medium.low,
        ranges.medium.high,
        ranges.high.low,
        ranges.high.high,
      )
    },

    ambiguityRanges(teamId) {
      const row = selectAmbiguityRanges.get(teamId)
      if (row === undefined) return undefined
      const range = (level: string) => ({ low: Number(row[`${level}_low`]), high: Number(row[`${level}_high`]) })
      return {
        teamId: String(row.team_id),
        low: range('low'),
        medium: range('medium'),
        high: range('high'),
      } satisfies AmbiguityRanges
    },

    saveCapacityEntries(teamId, entries) {
      transaction(() => {
        deleteCapacityEntries.run(teamId)
        for (const entry of entries) {
          insertCapacityEntry.run(teamId, entry.id, entry.from, entry.to ?? null, entry.percent, entry.note)
        }
      })
    },

    capacityEntries(teamId) {
      return selectCapacityEntries.all(teamId).map(
        (row: Row) =>
          ({
            id: Number(row.id),
            from: String(row.from_date),
            to: row.to_date === null ? undefined : String(row.to_date),
            percent: Number(row.percent),
            note: String(row.note),
          }) satisfies CapacityEntry,
      )
    },

    saveCapacityOn(teamId, on) {
      upsertCapacitySwitch.run(teamId, on ? 1 : 0)
    },

    capacityOn(teamId) {
      const row = selectCapacitySwitch.get(teamId)
      return row === undefined || Number(row.capacity_on) === 1
    },

    close() {
      db.close()
    },
  }
}

/** Brings the file up to the latest schema, one step per transaction, recording the version after each. */
function migrate(db: DatabaseSync, file: string, transaction: (work: () => void) => void): void {
  const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
  if (version > MIGRATIONS.length) {
    db.close()
    throw new Error(
      `${file} was written by a newer version of the Forecaster (schema ${version}; this version reads up to schema ${MIGRATIONS.length}). ` +
        'Update the Forecaster to open it.',
    )
  }
  for (let next = version; next < MIGRATIONS.length; next++) {
    transaction(() => {
      db.exec(MIGRATIONS[next]!)
      db.exec(`PRAGMA user_version = ${next + 1}`)
    })
  }
}
