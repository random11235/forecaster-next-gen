import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { choiceKindOf, type Choice } from '../connectors/connector.js'
import type { Ambiguity, AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import { PACE_MODES, type MilestoneInputs, type PaceMode, type PaceWindow, type SeenReads, type TicketsSource } from '../model/milestoneInputs.js'
import type { MilestoneQuery } from '../model/milestoneQuery.js'
import type { SavedRead } from '../model/savedRead.js'
import type { FailedRead, FailedReads, ReadFailures } from '../model/readFailures.js'
import type { SetupDraft } from '../model/setupDraft.js'
import type { Team } from '../model/team.js'
import type { ConnectionStorage, MilestoneQueryStorage, SavedReadStorage, SetupClosed, SetupState, SetupStorage, Storage } from './storage.js'

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
  // 11: each entry's new-usual accept and kept dismissal (#169). An entry from before has neither.
  `
ALTER TABLE capacity_entries ADD COLUMN new_usual_on TEXT;
ALTER TABLE capacity_entries ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;
`,
  // 12: the milestone's pace window (#161), as JSON: the pace pattern action applied, if any. A file from before has none.
  `
ALTER TABLE milestone_inputs ADD COLUMN pace_window TEXT NOT NULL DEFAULT '{}';
`,
  // 13: each team's connection (#178), at most one: GitHub's owner and repo, or Jira's site, project key and account
  // email. Never a token. A file from before has none.
  `
CREATE TABLE connections (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  tracker TEXT NOT NULL,
  owner TEXT,
  repo TEXT,
  site TEXT,
  project_key TEXT,
  email TEXT
);
`,
  // 14: the last read of each of a team's queries (#183), replaced whole on each read: whether it was incomplete and
  // when it was read, and its tickets by id and finish time only (open tickets have none). A file from before has none.
  `
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
`,
  // 15: the milestone's picks and query (#190), replaced together: the query as the EM picked or wrote it, and the
  // picks as a JSON array of each choice's kind, name and query, in the order picked. A file from before has neither.
  `
CREATE TABLE milestone_queries (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  query TEXT NOT NULL,
  picks TEXT NOT NULL
);
`,
  // 16: comparable work's picks and query (#201), in the milestone query's shape, kept apart from it. A file from
  // before has neither.
  `
CREATE TABLE comparable_work_queries (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  query TEXT NOT NULL,
  picks TEXT NOT NULL
);
`,
  // 17: where tickets remaining comes from (#210), and which of each value's tracker readings the EM has opened, as
  // JSON. The pace window's JSON gains the skipped periods, needing no column. A file from before has tickets typed, its
  // pace mode as it was, no skips and nothing seen.
  `
ALTER TABLE milestone_inputs ADD COLUMN tickets_source TEXT NOT NULL DEFAULT 'typed';
ALTER TABLE milestone_inputs ADD COLUMN seen_reads TEXT NOT NULL DEFAULT '{}';
`,
  // 18: the read each query's latest replaced (#214), in the saved read's shape, which the faint previous value comes
  // from. A file from before has none: its next read keeps the one it replaces.
  `
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
  `,
  // 19: how far back each saved read counts finished tickets (#213), which now reaches past the skipped periods. A read
  // saved before reached back 8 weeks from when it was made.
  `
ALTER TABLE saved_reads ADD COLUMN finished_since TEXT;
UPDATE saved_reads SET finished_since = strftime('%Y-%m-%dT%H:%M:%fZ', read_at, '-56 days');
ALTER TABLE previous_reads ADD COLUMN finished_since TEXT;
UPDATE previous_reads SET finished_since = strftime('%Y-%m-%dT%H:%M:%fZ', read_at, '-56 days');
`,
  // 20: setup (#217–#222). Where each team's setup steps stand: closed (`open` 0) as `closed` says, done or skipped; or
  // open, opened again from how `closed` says they were closed, or in a first setup with none, and what the opening did
  // to the connection (`made` or `changed`, none for nothing). No row is a first setup that has made nothing. A team
  // already connected with a milestone query has finished setting up, so it is done; any other team's steps are open,
  // a connection made before them kept by Cancel.
  //
  // Beside it, the setup draft, what the EM has chosen inside setup and not yet applied: each step's picks (as the
  // milestone query's are kept) and query, none until changed there; the source chosen at Check for each value; the
  // reads made there, in the saved reads' shape; and why a pick's own read at Check failed. And why the team's last
  // reads failed: a read by hand as a whole (`of` 'whole', with no query), a step's query's own read (`query`), or a
  // pick's at Check (`pick`), by the query read; an `invalidQuery` failure with the tracker's message.
  `
CREATE TABLE setups (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  open INTEGER NOT NULL,
  closed TEXT,
  connection TEXT
);
INSERT INTO setups (team_id, open, closed)
  SELECT connections.team_id, 0, 'done' FROM connections JOIN milestone_queries ON milestone_queries.team_id = connections.team_id
  WHERE milestone_queries.query <> '';
CREATE TABLE setup_drafts (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  milestone_query TEXT,
  milestone_picks TEXT,
  comparable_work_query TEXT,
  comparable_work_picks TEXT,
  tickets_source TEXT,
  pace_mode TEXT
);
CREATE TABLE setup_draft_reads (
  team_id TEXT NOT NULL REFERENCES setup_drafts(team_id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  incomplete INTEGER NOT NULL,
  read_at TEXT NOT NULL,
  finished_since TEXT NOT NULL,
  PRIMARY KEY (team_id, query)
);
CREATE TABLE setup_draft_read_tickets (
  team_id TEXT NOT NULL,
  query TEXT NOT NULL,
  position INTEGER NOT NULL,
  id TEXT NOT NULL,
  finished_at TEXT,
  PRIMARY KEY (team_id, query, position),
  FOREIGN KEY (team_id, query) REFERENCES setup_draft_reads(team_id, query) ON DELETE CASCADE
);
CREATE TABLE setup_draft_failures (
  team_id TEXT NOT NULL REFERENCES setup_drafts(team_id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  failure TEXT NOT NULL,
  message TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (team_id, query)
);
CREATE TABLE read_failures (
  team_id TEXT NOT NULL REFERENCES teams(id),
  of TEXT NOT NULL,
  query TEXT NOT NULL,
  failure TEXT NOT NULL,
  message TEXT,
  at TEXT NOT NULL,
  PRIMARY KEY (team_id, of, query)
);
`,
]

type Row = Record<string, SQLInputValue>

/** The local server build's storage: everything, and the team's connection, saved reads, milestone query and comparable work's, and how its setup was closed. */
export type SqliteStorage = Storage & ConnectionStorage & SavedReadStorage & MilestoneQueryStorage & SetupStorage

/** Opens (creating if needed) the SQLite file at `file`. `':memory:'` keeps everything in memory. */
export function openSqliteStorage(file: string): SqliteStorage {
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
       pace_cadence_days, pace_window, tickets_source, seen_reads)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      name = excluded.name, start_date = excluded.start_date, tickets_remaining = excluded.tickets_remaining,
      ambiguity = excluded.ambiguity, cadence_days = excluded.cadence_days, pace_mode = excluded.pace_mode,
      pace_low = excluded.pace_low, pace_high = excluded.pace_high, pace_counts = excluded.pace_counts,
      pace_cadence_days = excluded.pace_cadence_days, pace_window = excluded.pace_window,
      tickets_source = excluded.tickets_source, seen_reads = excluded.seen_reads`)
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
    'INSERT INTO capacity_entries (team_id, id, from_date, to_date, percent, note, new_usual_on, kept) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const selectCapacityEntries = db.prepare('SELECT * FROM capacity_entries WHERE team_id = ? ORDER BY rowid')
  const upsertCapacitySwitch = db.prepare(
    'INSERT INTO capacity_switch (team_id, capacity_on) VALUES (?, ?) ON CONFLICT (team_id) DO UPDATE SET capacity_on = excluded.capacity_on',
  )
  const selectCapacitySwitch = db.prepare('SELECT capacity_on FROM capacity_switch WHERE team_id = ?')
  const upsertConnection = db.prepare(`
    INSERT INTO connections (team_id, tracker, owner, repo, site, project_key, email) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      tracker = excluded.tracker, owner = excluded.owner, repo = excluded.repo, site = excluded.site,
      project_key = excluded.project_key, email = excluded.email`)
  const selectConnection = db.prepare('SELECT * FROM connections WHERE team_id = ?')
  const deleteConnection = db.prepare('DELETE FROM connections WHERE team_id = ?')
  const deleteSavedRead = db.prepare('DELETE FROM saved_reads WHERE team_id = ? AND query = ?')
  const insertSavedRead = db.prepare('INSERT INTO saved_reads (team_id, query, incomplete, read_at, finished_since) VALUES (?, ?, ?, ?, ?)')
  const insertSavedReadTicket = db.prepare(
    'INSERT INTO saved_read_tickets (team_id, query, position, id, finished_at) VALUES (?, ?, ?, ?, ?)',
  )
  const selectSavedRead = db.prepare('SELECT incomplete, read_at, finished_since FROM saved_reads WHERE team_id = ? AND query = ?')
  const selectSavedReadTickets = db.prepare(
    'SELECT id, finished_at FROM saved_read_tickets WHERE team_id = ? AND query = ? ORDER BY position',
  )
  const deletePreviousRead = db.prepare('DELETE FROM previous_reads WHERE team_id = ? AND query = ?')
  const keepPreviousRead = db.prepare(
    'INSERT INTO previous_reads (team_id, query, incomplete, read_at, finished_since) SELECT team_id, query, incomplete, read_at, finished_since FROM saved_reads WHERE team_id = ? AND query = ?',
  )
  const keepPreviousReadTickets = db.prepare(`
    INSERT INTO previous_read_tickets (team_id, query, position, id, finished_at)
    SELECT team_id, query, position, id, finished_at FROM saved_read_tickets WHERE team_id = ? AND query = ?`)
  const selectPreviousRead = db.prepare('SELECT incomplete, read_at, finished_since FROM previous_reads WHERE team_id = ? AND query = ?')
  const selectPreviousReadTickets = db.prepare(
    'SELECT id, finished_at FROM previous_read_tickets WHERE team_id = ? AND query = ? ORDER BY position',
  )
  const upsertMilestoneQuery = db.prepare(`
    INSERT INTO milestone_queries (team_id, query, picks) VALUES (?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET query = excluded.query, picks = excluded.picks`)
  const selectMilestoneQuery = db.prepare('SELECT query, picks FROM milestone_queries WHERE team_id = ?')
  const upsertComparableWorkQuery = db.prepare(`
    INSERT INTO comparable_work_queries (team_id, query, picks) VALUES (?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET query = excluded.query, picks = excluded.picks`)
  const selectComparableWorkQuery = db.prepare('SELECT query, picks FROM comparable_work_queries WHERE team_id = ?')
  const upsertSetup = db.prepare(`
    INSERT INTO setups (team_id, open, closed, connection) VALUES (?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET open = excluded.open, closed = excluded.closed, connection = excluded.connection`)
  const selectSetup = db.prepare('SELECT open, closed, connection FROM setups WHERE team_id = ?')
  const insertSetupDraft = db.prepare(`
    INSERT INTO setup_drafts (team_id, milestone_query, milestone_picks, comparable_work_query, comparable_work_picks, tickets_source, pace_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const selectSetupDraft = db.prepare(`
    SELECT milestone_query, milestone_picks, comparable_work_query, comparable_work_picks, tickets_source, pace_mode FROM setup_drafts WHERE team_id = ?`)
  const deleteSetupDraft = db.prepare('DELETE FROM setup_drafts WHERE team_id = ?')
  const insertDraftRead = db.prepare('INSERT INTO setup_draft_reads (team_id, query, incomplete, read_at, finished_since) VALUES (?, ?, ?, ?, ?)')
  const insertDraftReadTicket = db.prepare('INSERT INTO setup_draft_read_tickets (team_id, query, position, id, finished_at) VALUES (?, ?, ?, ?, ?)')
  const selectDraftReads = db.prepare('SELECT query, incomplete, read_at, finished_since FROM setup_draft_reads WHERE team_id = ? ORDER BY rowid')
  const selectDraftReadTickets = db.prepare('SELECT id, finished_at FROM setup_draft_read_tickets WHERE team_id = ? AND query = ? ORDER BY position')
  const insertDraftFailure = db.prepare('INSERT INTO setup_draft_failures (team_id, query, failure, message, at) VALUES (?, ?, ?, ?, ?)')
  const selectDraftFailures = db.prepare('SELECT query, failure, message, at FROM setup_draft_failures WHERE team_id = ? ORDER BY rowid')
  const insertReadFailure = db.prepare('INSERT INTO read_failures (team_id, of, query, failure, message, at) VALUES (?, ?, ?, ?, ?, ?)')
  const selectReadFailures = db.prepare('SELECT of, query, failure, message, at FROM read_failures WHERE team_id = ? ORDER BY rowid')
  const deleteReadFailures = db.prepare('DELETE FROM read_failures WHERE team_id = ?')

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
        JSON.stringify(inputs.paceWindow),
        inputs.ticketsSource,
        JSON.stringify(inputs.seenReads),
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
        paceWindow: paceWindowOf(String(row.pace_window)),
        ticketsSource: String(row.tickets_source) as TicketsSource,
        seenReads: seenReadsOf(String(row.seen_reads)),
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
          insertCapacityEntry.run(teamId, entry.id, entry.from, entry.to ?? null, entry.percent, entry.note, entry.newUsualOn ?? null, entry.kept ? 1 : 0)
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
            ...(row.new_usual_on !== null && { newUsualOn: String(row.new_usual_on) }),
            ...(Number(row.kept) === 1 && { kept: true as const }),
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

    saveConnection(teamId, connection) {
      if (connection.tracker === 'github') upsertConnection.run(teamId, 'github', connection.owner, connection.repo, null, null, null)
      else upsertConnection.run(teamId, 'jira', null, null, connection.site, connection.projectKey, connection.email)
    },

    connection(teamId) {
      const row = selectConnection.get(teamId)
      if (row === undefined) return undefined
      if (row.tracker === 'github') return { tracker: 'github', owner: String(row.owner), repo: String(row.repo) }
      return { tracker: 'jira', site: String(row.site), projectKey: String(row.project_key), email: String(row.email) }
    },

    removeConnection(teamId) {
      deleteConnection.run(teamId)
    },

    saveRead({ teamId, query }, read) {
      transaction(() => {
        // the read this one replaces is kept as the previous read, replacing the one before it
        deletePreviousRead.run(teamId, query)
        keepPreviousRead.run(teamId, query)
        keepPreviousReadTickets.run(teamId, query)
        deleteSavedRead.run(teamId, query)
        insertSavedRead.run(teamId, query, read.incomplete ? 1 : 0, read.readAt, read.finishedSince)
        read.tickets.forEach((ticket, position) => {
          insertSavedReadTicket.run(teamId, query, position, ticket.id, ticket.finishedAt ?? null)
        })
      })
    },

    savedRead({ teamId, query }) {
      return readRow(selectSavedRead.get(teamId, query), () => selectSavedReadTickets.all(teamId, query))
    },

    previousRead({ teamId, query }) {
      return readRow(selectPreviousRead.get(teamId, query), () => selectPreviousReadTickets.all(teamId, query))
    },

    saveMilestoneQuery(teamId, milestoneQuery) {
      upsertMilestoneQuery.run(teamId, milestoneQuery.query, picksKept(milestoneQuery.picks))
    },

    milestoneQuery(teamId) {
      return queryIn(selectMilestoneQuery.get(teamId))
    },

    saveComparableWorkQuery(teamId, comparableWorkQuery) {
      upsertComparableWorkQuery.run(teamId, comparableWorkQuery.query, picksKept(comparableWorkQuery.picks))
    },

    comparableWorkQuery(teamId) {
      return queryIn(selectComparableWorkQuery.get(teamId))
    },

    setupState(teamId) {
      return setupStateIn(selectSetup.get(teamId))
    },

    saveSetupState(teamId, state) {
      if (!state.open) upsertSetup.run(teamId, 0, state.closed, null)
      else upsertSetup.run(teamId, 1, state.reopened ?? null, state.connection ?? null)
    },

    setupDraft(teamId) {
      const row = selectSetupDraft.get(teamId)
      if (row === undefined) return undefined
      const reads = selectDraftReads.all(teamId).map((read) => ({
        query: String(read.query),
        read: readRow(read, () => selectDraftReadTickets.all(teamId, String(read.query)))!,
      }))
      const pickFailures = failedReadsIn(selectDraftFailures.all(teamId))
      const sources = {
        ...(ticketsSourceOf(row.tickets_source) && { ticketsRemaining: ticketsSourceOf(row.tickets_source)! }),
        ...(paceModeOf(row.pace_mode) && { pace: paceModeOf(row.pace_mode)! }),
      }
      return {
        ...(row.milestone_query !== null && { milestoneQuery: { picks: picksIn(String(row.milestone_picks)), query: String(row.milestone_query) } }),
        ...(row.comparable_work_query !== null && { comparableWorkQuery: { picks: picksIn(String(row.comparable_work_picks)), query: String(row.comparable_work_query) } }),
        reads,
        ...(Object.keys(sources).length > 0 && { sources }),
        ...(pickFailures && { pickFailures }),
      } satisfies SetupDraft
    },

    saveSetupDraft(teamId, draft) {
      transaction(() => {
        // its reads and failures go with it
        deleteSetupDraft.run(teamId)
        const { milestoneQuery: milestone, comparableWorkQuery: comparable, sources } = draft
        insertSetupDraft.run(
          teamId,
          milestone?.query ?? null,
          milestone ? picksKept(milestone.picks) : null,
          comparable?.query ?? null,
          comparable ? picksKept(comparable.picks) : null,
          sources?.ticketsRemaining ?? null,
          sources?.pace ?? null,
        )
        for (const { query, read } of draft.reads) {
          insertDraftRead.run(teamId, query, read.incomplete ? 1 : 0, read.readAt, read.finishedSince)
          read.tickets.forEach((ticket, position) => insertDraftReadTicket.run(teamId, query, position, ticket.id, ticket.finishedAt ?? null))
        }
        for (const [query, failed] of Object.entries(draft.pickFailures ?? {})) insertDraftFailure.run(teamId, query, ...failureKept(failed))
      })
    },

    discardSetupDraft(teamId) {
      deleteSetupDraft.run(teamId)
    },

    readFailures(teamId) {
      const rows = selectReadFailures.all(teamId)
      const of = (kind: string): Row[] => rows.filter((row) => row.of === kind)
      const whole = failedReadsIn(of('whole'))?.['']
      const queries = failedReadsIn(of('query'))
      const picks = failedReadsIn(of('pick'))
      const failures = { ...(whole && { whole }), ...(queries && { queries }), ...(picks && { picks }) } satisfies ReadFailures
      return Object.keys(failures).length === 0 ? undefined : failures
    },

    saveReadFailures(teamId, { whole, queries = {}, picks = {} }) {
      transaction(() => {
        deleteReadFailures.run(teamId)
        if (whole) insertReadFailure.run(teamId, 'whole', '', ...failureKept(whole))
        for (const [query, failed] of Object.entries(queries)) insertReadFailure.run(teamId, 'query', query, ...failureKept(failed))
        for (const [query, failed] of Object.entries(picks)) insertReadFailure.run(teamId, 'pick', query, ...failureKept(failed))
      })
    },

    close() {
      db.close()
    },
  }
}

/** How setup can be closed. */
const SETUP_CLOSED: readonly SetupClosed[] = ['done', 'skipped']

/** What an opening of setup can have done to the connection. */
const CONNECTION_CHANGES = ['made', 'changed'] as const

/**
 * Where setup stands, from its row: open in a first setup with no row. Closed in a way this version doesn't know (from
 * a later one, say), it is open, so the steps show; an opening's change to the connection it doesn't know is none.
 */
function setupStateIn(row: Row | undefined): SetupState {
  const closed = SETUP_CLOSED.find((known) => known === row?.closed)
  if (row !== undefined && Number(row.open) === 0) return closed ? { open: false, closed } : { open: true }
  const connection = CONNECTION_CHANGES.find((known) => known === row?.connection)
  return { open: true, ...(closed && { reopened: closed }), ...(connection && { connection }) }
}

/** A drafted source of tickets remaining, from its column: none for none, or one this version doesn't know. */
const ticketsSourceOf = (value: unknown): TicketsSource | undefined => (['tracker', 'typed'] as const).find((known) => known === value)

/** A drafted pace mode, from its column: none for none, or one this version doesn't know. */
const paceModeOf = (value: unknown): PaceMode | undefined => PACE_MODES.find((known) => known === value)

/** Every failure a read can have. */
const FAILURES: readonly FailedRead['failure'][] = ['invalidQuery', 'outOfScope', 'notFound', 'unauthorised', 'unavailable', 'keychainFailed']

/** A failed read's failure, message (an `invalidQuery`'s only) and when it was asked for, as its row keeps them. */
function failureKept(failed: FailedRead): [string, string | null, string] {
  return [failed.failure, failed.failure === 'invalidQuery' ? failed.message : null, failed.at]
}

/** Each failed read in `rows`, by its query; none for no rows. A failure this version doesn't know (from a later one) is left out. */
function failedReadsIn(rows: readonly Row[]): FailedReads | undefined {
  const failed = rows.flatMap((row): [string, FailedRead][] => {
    const failure = FAILURES.find((known) => known === row.failure)
    const at = String(row.at)
    if (!failure) return []
    return [[String(row.query), failure === 'invalidQuery' ? { failure, message: String(row.message ?? ''), at } : { failure, at }]]
  })
  return failed.length === 0 ? undefined : Object.fromEntries(failed)
}

/** The picks as a row keeps them: a JSON array of each one's kind, name and query, in order, and nothing else of it. */
function picksKept(picks: readonly Choice[]): string {
  return JSON.stringify(picks.map(({ kind, name, query }) => ({ kind, name, query })))
}

/** The picks and query a row of `milestone_queries` or `comparable_work_queries` keeps; none for no row. */
function queryIn(row: Row | undefined): MilestoneQuery | undefined {
  if (row === undefined) return undefined
  return { picks: picksIn(String(row.picks)), query: String(row.query) }
}

/**
 * The picks a row keeps, in order, less any of a kind this version doesn't know (written by a later one, say), which
 * it couldn't show as a chip. The query is kept as written, so it stays in use: the step opens it for editing, as its
 * picks no longer make it.
 */
function picksIn(json: string): Choice[] {
  const stored = JSON.parse(json) as { kind: string; name: string; query: string }[]
  return stored.flatMap(({ kind, name, query }) => {
    const known = choiceKindOf(kind)
    return known ? [{ kind: known, name, query }] : []
  })
}

/** A saved or previous read from its row and its tickets' rows; none without a row. */
function readRow(row: Row | undefined, tickets: () => Row[]): SavedRead | undefined {
  if (row === undefined) return undefined
  return {
    tickets: tickets().map((ticket) => ({
      id: String(ticket.id),
      ...(ticket.finished_at !== null && { finishedAt: String(ticket.finished_at) }),
    })),
    incomplete: Number(row.incomplete) === 1,
    readAt: String(row.read_at),
    finishedSince: String(row.finished_since),
  } satisfies SavedRead
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

/** The pace window as saved: a file from before #161 has no action, and one from before #210 no skipped periods. */
function paceWindowOf(json: string): PaceWindow {
  const { action, skippedPeriods } = JSON.parse(json) as Partial<PaceWindow>
  return { action, skippedPeriods: skippedPeriods ?? [] }
}

/** The reads seen as saved: JSON drops an undefined `readAt`, and a file from before #210 has seen none. */
function seenReadsOf(json: string): SeenReads {
  const { ticketsRemaining, pace } = JSON.parse(json) as Partial<SeenReads>
  return { ticketsRemaining, pace }
}
