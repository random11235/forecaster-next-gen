import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Ambiguity, AmbiguityRanges, EpicAmbiguity } from '../model/ambiguity.js'
import type { EpicCommit } from '../model/epicCommit.js'
import type { Milestone } from '../model/milestone.js'
import type { MilestoneInputs, PaceMode } from '../model/milestoneInputs.js'
import type { Team } from '../model/team.js'
import type { StatusMapping } from '../model/workflow.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'
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
  // 2: each team's workflow settings (#18). Teams already stored get the sample board's workflow, as in
  // `defaultWorkflowSettings`. Lists are JSON arrays, as work_items.labels is.
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
  // epics were created, as `SAMPLE_DATA` has it.
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
  const upsertItem = db.prepare(`
    INSERT INTO work_items (id, team_id, source_key, type, title, parent_id, labels, created_at, started_at, done_at, cancelled_at, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id, id) DO UPDATE SET
      source_key = excluded.source_key, type = excluded.type, title = excluded.title,
      parent_id = excluded.parent_id, labels = excluded.labels, created_at = excluded.created_at,
      started_at = excluded.started_at, done_at = excluded.done_at, cancelled_at = excluded.cancelled_at,
      last_synced_at = excluded.last_synced_at`)
  const insertEvent = db.prepare(`
    INSERT INTO work_item_events (team_id, item_id, at, kind, from_value, to_value)
    VALUES (?, ?, ?, ?, ?, ?)`)
  const upsertMilestone = db.prepare(`
    INSERT INTO milestones (id, team_id, name, committed_date) VALUES (?, ?, ?, ?)
    ON CONFLICT (team_id, id) DO UPDATE SET name = excluded.name, committed_date = excluded.committed_date`)
  const deleteMilestoneEpics = db.prepare('DELETE FROM milestone_epics WHERE team_id = ? AND milestone_id = ?')
  const insertMilestoneEpic = db.prepare(
    'INSERT INTO milestone_epics (team_id, milestone_id, rank, epic_id) VALUES (?, ?, ?, ?)',
  )
  const upsertPaceSetting = db.prepare(`
    INSERT INTO pace_settings (team_id, milestone_id, mode, low, high) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (team_id, milestone_id) DO UPDATE SET mode = excluded.mode, low = excluded.low, high = excluded.high`)
  const selectPaceSetting = db.prepare(
    'SELECT team_id, milestone_id, mode, low, high FROM pace_settings WHERE team_id = ? AND milestone_id = ?',
  )
  const upsertMilestoneInputs = db.prepare(`
    INSERT INTO milestone_inputs
      (team_id, name, start_date, tickets_remaining, ambiguity, cadence_days, pace_mode, pace_low, pace_high, pace_counts)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      name = excluded.name, start_date = excluded.start_date, tickets_remaining = excluded.tickets_remaining,
      ambiguity = excluded.ambiguity, cadence_days = excluded.cadence_days, pace_mode = excluded.pace_mode,
      pace_low = excluded.pace_low, pace_high = excluded.pace_high, pace_counts = excluded.pace_counts`)
  const selectMilestoneInputs = db.prepare('SELECT * FROM milestone_inputs WHERE team_id = ?')
  const upsertWorkflowSettings = db.prepare(`
    INSERT INTO workflow_settings (team_id, statuses, started_status, commit_label, blocked_statuses, blocked_labels)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      statuses = excluded.statuses, started_status = excluded.started_status, commit_label = excluded.commit_label,
      blocked_statuses = excluded.blocked_statuses, blocked_labels = excluded.blocked_labels`)
  const selectWorkflowSettings = db.prepare('SELECT * FROM workflow_settings WHERE team_id = ?')
  const upsertEpicCommit = db.prepare(`
    INSERT INTO epic_commits (team_id, epic_id, committed_at, child_count_at_commit) VALUES (?, ?, ?, ?)
    ON CONFLICT (team_id, epic_id) DO UPDATE SET
      committed_at = excluded.committed_at, child_count_at_commit = excluded.child_count_at_commit`)
  const selectEpicCommits = db.prepare('SELECT * FROM epic_commits WHERE team_id = ? ORDER BY rowid')
  const upsertAmbiguityRanges = db.prepare(`
    INSERT INTO ambiguity_ranges (team_id, low_low, low_high, medium_low, medium_high, high_low, high_high, medium_measured)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      low_low = excluded.low_low, low_high = excluded.low_high, medium_low = excluded.medium_low,
      medium_high = excluded.medium_high, high_low = excluded.high_low, high_high = excluded.high_high,
      medium_measured = excluded.medium_measured`)
  const selectAmbiguityRanges = db.prepare('SELECT * FROM ambiguity_ranges WHERE team_id = ?')
  const upsertEpicAmbiguity = db.prepare(`
    INSERT INTO epic_ambiguities (team_id, milestone_id, epic_id, ambiguity) VALUES (?, ?, ?, ?)
    ON CONFLICT (team_id, milestone_id, epic_id) DO UPDATE SET ambiguity = excluded.ambiguity`)
  const selectEpicAmbiguities = db.prepare(
    'SELECT * FROM epic_ambiguities WHERE team_id = ? AND milestone_id = ? ORDER BY rowid',
  )

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

    addFacts(teamId, facts) {
      transaction(() => {
        for (const item of facts.workItems) {
          if (item.teamId !== teamId) throw new Error(`Work item ${item.id} belongs to team ${item.teamId}, not ${teamId}.`)
          upsertItem.run(
            item.id,
            teamId,
            item.sourceKey,
            item.type,
            item.title ?? null,
            item.parentId ?? null,
            JSON.stringify(item.labels),
            item.createdAt,
            item.startedAt ?? null,
            item.doneAt ?? null,
            item.cancelledAt ?? null,
            item.lastSyncedAt,
          )
        }
        for (const event of facts.events) {
          insertEvent.run(teamId, event.itemId, event.at, event.kind, event.from ?? null, event.to ?? null)
        }
      })
    },

    facts(teamId) {
      const workItems = db
        .prepare('SELECT * FROM work_items WHERE team_id = ? ORDER BY rowid')
        .all(teamId)
        .map(toWorkItem)
      const events = db
        .prepare('SELECT * FROM work_item_events WHERE team_id = ? ORDER BY rowid')
        .all(teamId)
        .map(toEvent)
      return { workItems, events }
    },

    saveMilestone(milestone) {
      transaction(() => {
        upsertMilestone.run(milestone.id, milestone.teamId, milestone.name, milestone.committedDate)
        deleteMilestoneEpics.run(milestone.teamId, milestone.id)
        milestone.epicIds.forEach((epicId, rank) =>
          insertMilestoneEpic.run(milestone.teamId, milestone.id, rank, epicId),
        )
      })
    },

    milestones(teamId) {
      const epics = db.prepare('SELECT epic_id FROM milestone_epics WHERE team_id = ? AND milestone_id = ? ORDER BY rank')
      return db
        .prepare('SELECT id, team_id, name, committed_date FROM milestones WHERE team_id = ? ORDER BY rowid')
        .all(teamId)
        .map(
          (row: Row): Milestone => ({
            id: String(row.id),
            teamId: String(row.team_id),
            name: String(row.name),
            committedDate: String(row.committed_date),
            epicIds: epics.all(teamId, String(row.id)).map((epic: Row) => String(epic.epic_id)),
          }),
        )
    },

    savePaceSetting(setting) {
      upsertPaceSetting.run(setting.teamId, setting.milestoneId, setting.mode, setting.manual?.low ?? null, setting.manual?.high ?? null)
    },

    paceSetting(teamId, milestoneId) {
      const row = selectPaceSetting.get(teamId, milestoneId)
      if (row === undefined) return undefined
      return {
        teamId: String(row.team_id),
        milestoneId: String(row.milestone_id),
        mode: row.mode === 'measured' ? 'measured' : 'manual',
        manual: row.low === null ? undefined : { low: Number(row.low), high: Number(row.high) },
      }
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
      } satisfies MilestoneInputs
    },

    saveWorkflowSettings(settings) {
      upsertWorkflowSettings.run(
        settings.teamId,
        JSON.stringify(settings.statuses),
        settings.startedStatus,
        settings.commitLabel ?? null,
        JSON.stringify(settings.blockedRule.statuses),
        JSON.stringify(settings.blockedRule.labels),
      )
    },

    workflowSettings(teamId) {
      const row = selectWorkflowSettings.get(teamId)
      if (row === undefined) return undefined
      const list = (value: SQLInputValue | undefined): string[] => JSON.parse(String(value)) as string[]
      return {
        teamId: String(row.team_id),
        statuses: JSON.parse(String(row.statuses)) as StatusMapping[],
        startedStatus: String(row.started_status),
        ...optional('commitLabel', row.commit_label),
        blockedRule: { statuses: list(row.blocked_statuses), labels: list(row.blocked_labels) },
      }
    },

    saveEpicCommit(commit) {
      upsertEpicCommit.run(commit.teamId, commit.epicId, commit.committedAt, commit.baseline)
    },

    epicCommits(teamId) {
      return selectEpicCommits.all(teamId).map(
        (row: Row): EpicCommit => ({
          teamId: String(row.team_id),
          epicId: String(row.epic_id),
          committedAt: String(row.committed_at),
          baseline: Number(row.child_count_at_commit),
        }),
      )
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
        ranges.mediumMeasured ? 1 : 0,
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
        mediumMeasured: Number(row.medium_measured) === 1,
      } satisfies AmbiguityRanges
    },

    saveEpicAmbiguity(setting) {
      upsertEpicAmbiguity.run(setting.teamId, setting.milestoneId, setting.epicId, setting.ambiguity)
    },

    epicAmbiguities(teamId, milestoneId) {
      return selectEpicAmbiguities.all(teamId, milestoneId).map(
        (row: Row): EpicAmbiguity => ({
          teamId: String(row.team_id),
          milestoneId: String(row.milestone_id),
          epicId: String(row.epic_id),
          ambiguity: String(row.ambiguity) as Ambiguity,
        }),
      )
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

function toWorkItem(row: Row): WorkItem {
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    sourceKey: String(row.source_key),
    type: String(row.type),
    ...optional('title', row.title),
    ...optional('parentId', row.parent_id),
    labels: JSON.parse(String(row.labels)) as string[],
    createdAt: String(row.created_at),
    ...optional('startedAt', row.started_at),
    ...optional('doneAt', row.done_at),
    ...optional('cancelledAt', row.cancelled_at),
    lastSyncedAt: String(row.last_synced_at),
  }
}

function toEvent(row: Row): WorkItemEvent {
  return {
    itemId: String(row.item_id),
    at: String(row.at),
    kind: String(row.kind) as WorkItemEvent['kind'],
    ...optional('from', row.from_value),
    ...optional('to', row.to_value),
  }
}

/** A column that may be NULL, as an optional property: present only when it has a value. */
function optional<K extends string>(key: K, value: SQLInputValue | undefined): { [P in K]?: string } {
  return value === null || value === undefined ? {} : ({ [key]: String(value) } as { [P in K]: string })
}
