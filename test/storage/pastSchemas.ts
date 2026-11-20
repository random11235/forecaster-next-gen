// The data files earlier releases left, as SQL: each version's tables, built on the one before. The migration tests
// write a file from one of these (migrationsHarness.ts) and open it through openSqliteStorage.

export const TEAM = 'ACME'
export const CREATED = '2026-09-01T09:00:00Z'

/** The schema as shipped by #16 and #17, before the file recorded a version. Kept verbatim: it is a past release. */
export const UNVERSIONED_SCHEMA = `
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

/** Version 2's tables: version 1's, plus workflow settings as #18 shipped them. Kept verbatim: it is a past release. */
export const VERSION_2_SCHEMA = `${UNVERSIONED_SCHEMA}
CREATE TABLE workflow_settings (
  team_id TEXT PRIMARY KEY REFERENCES teams(id), statuses TEXT NOT NULL, started_status TEXT NOT NULL,
  spike_types TEXT NOT NULL, spike_labels TEXT NOT NULL, commit_label TEXT, blocked_statuses TEXT NOT NULL,
  blocked_labels TEXT NOT NULL
);
INSERT INTO workflow_settings VALUES ('ACME', '[{"status":"Doing","category":"started"}]', 'Doing', '[]', '[]', NULL, '[]', '[]');
`

/** Version 4's tables: version 3's, less its spike rules. Kept verbatim: it is a past release. */
export const VERSION_4_SCHEMA = `${VERSION_2_SCHEMA}
ALTER TABLE workflow_settings DROP COLUMN spike_types;
ALTER TABLE workflow_settings DROP COLUMN spike_labels;
CREATE TABLE epic_commits (
  team_id TEXT NOT NULL REFERENCES teams(id), epic_id TEXT NOT NULL, committed_at TEXT NOT NULL,
  child_count_at_commit INTEGER NOT NULL, PRIMARY KEY (team_id, epic_id)
);
`

/** Version 5's tables: version 4's, plus ambiguity as #21 shipped it. Kept verbatim: it is a past release. */
export const VERSION_5_SCHEMA = `${VERSION_4_SCHEMA}
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

/** Version 6's tables: version 5's, plus installation dates as #22 shipped them. Kept verbatim: it is a past release. */
export const VERSION_6_SCHEMA = `${VERSION_5_SCHEMA}
ALTER TABLE teams ADD COLUMN installed_at TEXT;
UPDATE teams SET installed_at = '2026-08-31T09:00:00Z';
INSERT INTO milestones VALUES ('ACME', 'M2', 'Later', '2027-03-01');
`

/** Version 7's tables: version 6's, plus milestone inputs as #85 shipped them. Kept verbatim: it is a past release. */
export const VERSION_7_SCHEMA = `${VERSION_6_SCHEMA}
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

/** Version 8's tables: version 7's, plus the cadence the pace was entered in as #99 shipped it. Kept verbatim. */
export const VERSION_8_SCHEMA = `${VERSION_7_SCHEMA}
ALTER TABLE milestone_inputs ADD COLUMN pace_cadence_days INTEGER;
UPDATE milestone_inputs SET pace_cadence_days = cadence_days WHERE pace_low IS NOT NULL OR pace_counts <> '[]';
`

/** Version 9's tables: version 8's, plus capacity entries as #164 shipped them. Kept verbatim: it is a past release. */
export const VERSION_9_SCHEMA = `${VERSION_8_SCHEMA}
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

/** Version 10's tables: version 9's, plus the capacity switch as #165 shipped it. Kept verbatim: it is a past release. */
export const VERSION_10_SCHEMA = `${VERSION_9_SCHEMA}
CREATE TABLE capacity_switch (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  capacity_on INTEGER NOT NULL
);
INSERT INTO capacity_entries (team_id, id, from_date, to_date, percent, note) VALUES ('${TEAM}', 2, '2026-08-03', NULL, 80, 'Two left');
`

/** Version 11's tables: version 10's, plus the new usual as #169 shipped it. Kept verbatim: it is a past release. */
export const VERSION_11_SCHEMA = `${VERSION_10_SCHEMA}
ALTER TABLE capacity_entries ADD COLUMN new_usual_on TEXT;
ALTER TABLE capacity_entries ADD COLUMN kept INTEGER NOT NULL DEFAULT 0;
`

/** Version 12's tables: version 11's, plus the pace window as #161 shipped it. Kept verbatim: it is a past release. */
export const VERSION_12_SCHEMA = `${VERSION_11_SCHEMA}
ALTER TABLE milestone_inputs ADD COLUMN pace_window TEXT NOT NULL DEFAULT '{}';
`

/** Version 13's tables: version 12's, plus the connection as #178 shipped it. Kept verbatim: it is a past release. */
export const VERSION_13_SCHEMA = `${VERSION_12_SCHEMA}
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

/** Version 14's tables: version 13's, plus saved reads as #183 shipped them. Kept verbatim: it is a past release. */
export const VERSION_14_SCHEMA = `${VERSION_13_SCHEMA}
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

/** Version 15's tables: version 14's, plus the milestone's picks and query as #190 shipped them. Kept verbatim: it is a past release. */
export const VERSION_15_SCHEMA = `${VERSION_14_SCHEMA}
CREATE TABLE milestone_queries (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  query TEXT NOT NULL,
  picks TEXT NOT NULL
);
INSERT INTO milestone_queries VALUES ('${TEAM}', 'milestone:"Launch"', '[{"kind":"milestone","name":"Launch","query":"milestone:\\"Launch\\""}]');
`

/** Version 16's tables: version 15's, plus comparable work's picks and query as #201 shipped them. Kept verbatim: it is a past release. */
export const VERSION_16_SCHEMA = `${VERSION_15_SCHEMA}
CREATE TABLE comparable_work_queries (
  team_id TEXT PRIMARY KEY REFERENCES teams(id),
  query TEXT NOT NULL,
  picks TEXT NOT NULL
);
UPDATE milestone_inputs SET pace_window = '{"action":{"kind":"leaveOut","period":"2026-08-17"}}' WHERE team_id = '${TEAM}';
`

/** Version 17's tables: version 16's, with the values' sources and reads seen as #210 shipped them, and a saved read. Kept verbatim: it is a past release. */
export const VERSION_17_SCHEMA = `${VERSION_16_SCHEMA}
ALTER TABLE milestone_inputs ADD COLUMN tickets_source TEXT NOT NULL DEFAULT 'typed';
ALTER TABLE milestone_inputs ADD COLUMN seen_reads TEXT NOT NULL DEFAULT '{}';
INSERT INTO saved_reads VALUES ('${TEAM}', 'milestone:"Launch"', 0, '2026-10-28T09:05:00Z');
INSERT INTO saved_read_tickets VALUES ('${TEAM}', 'milestone:"Launch"', 0, 'I_1', '2026-10-27T10:00:00Z');
INSERT INTO saved_read_tickets VALUES ('${TEAM}', 'milestone:"Launch"', 1, 'I_2', NULL);
`

/** Version 18's tables: version 17's, plus the previous reads as #214 shipped them, and a previous read. Kept verbatim: it is a past release. */
export const VERSION_18_SCHEMA = `${VERSION_17_SCHEMA}
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

/** Version 19's tables: version 18's, with how far back each read reaches as #213 shipped it. Kept verbatim: it is a past release. */
export const VERSION_19_SCHEMA = `${VERSION_18_SCHEMA}
ALTER TABLE saved_reads ADD COLUMN finished_since TEXT;
UPDATE saved_reads SET finished_since = strftime('%Y-%m-%dT%H:%M:%fZ', read_at, '-56 days');
ALTER TABLE previous_reads ADD COLUMN finished_since TEXT;
UPDATE previous_reads SET finished_since = strftime('%Y-%m-%dT%H:%M:%fZ', read_at, '-56 days');
`

/** Version 20's tables: version 19's, plus setup as #217–#222 shipped it. Kept verbatim: it is a past release. */
export const VERSION_20_SCHEMA = `${VERSION_19_SCHEMA}
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
`
