import type { DatabaseSync } from 'node:sqlite'
import { connectionTable } from './lib/connectionTable.js'
import { milestoneQueryTables } from './lib/milestoneQueryTables.js'
import { savedReadTables } from './lib/savedReadTables.js'
import { setupTables } from './lib/setupTables.js'
import { applySetupDraft, draftedQueries, saveDraftPickFailures, saveDraftSources, type TeamQueriesWithDraft } from './lib/setupDraft.js'
import { openDatabase, type Transaction } from './lib/sqliteDatabase.js'
import { teamTables } from './lib/teamTables.js'
import type { ConnectionStorage, MilestoneQueryStorage, SavedReadStorage, SetupStorage, Storage, TeamQueryStorage } from './storage.js'

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

/** The local server build's storage: everything, and the team's connection, saved reads, milestone query and comparable work's, and how its setup was closed. */
export type SqliteStorage = Storage & ConnectionStorage & SavedReadStorage & MilestoneQueryStorage & SetupStorage & TeamQueryStorage

/**
 * Opens (creating if needed) the SQLite file at `file`. `':memory:'` keeps everything in memory. Each part of it is
 * kept in lib/, a file per part: the team and its inputs, the connection, saved reads, the queries, and setup.
 */
export function openSqliteStorage(file: string): SqliteStorage {
  const { db, transaction } = openDatabase(file)
  migrate(db, file, transaction)

  // what each table keeps; the targets, and the draft's edits and "Use these", are made over it below
  const kept: Omit<SqliteStorage, keyof TeamQueryStorage | 'saveDraftSources' | 'saveDraftPickFailures'> = {
    ...teamTables(db, transaction),
    ...connectionTable(db),
    ...savedReadTables(db, transaction),
    ...milestoneQueryTables(db),
    ...setupTables(db, transaction),
    close() {
      db.close()
    },
  }
  const withDraft: TeamQueriesWithDraft = { milestoneQueries: kept, reads: kept, setup: kept }
  return {
    ...kept,
    saveDraftSources: (teamId, sources) => saveDraftSources(kept, teamId, sources),
    saveDraftPickFailures: (teamId, pickFailures) => saveDraftPickFailures(kept, teamId, pickFailures),
    teamQueries: (target) => draftedQueries(withDraft, target),
    applySetupDraft: (teamId) => applySetupDraft(withDraft, teamId),
  }
}

/** Brings the file up to the latest schema, one step per transaction, recording the version after each. */
function migrate(db: DatabaseSync, file: string, transaction: Transaction): void {
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
