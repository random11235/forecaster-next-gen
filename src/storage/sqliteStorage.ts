import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Milestone } from '../model/milestone.js'
import type { Team } from '../model/team.js'
import type { Facts, WorkItem, WorkItemEvent } from '../model/workItem.js'
import type { Storage } from './storage.js'

// Every table carries team_id, so every query can be scoped by team.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS work_items (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  source_key TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT,
  parent_id TEXT,
  labels TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  done_at TEXT,
  cancelled_at TEXT,
  last_synced_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS work_items_team ON work_items(team_id);
CREATE TABLE IF NOT EXISTS work_item_events (
  team_id TEXT NOT NULL REFERENCES teams(id),
  item_id TEXT NOT NULL REFERENCES work_items(id),
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_value TEXT,
  to_value TEXT
);
CREATE INDEX IF NOT EXISTS work_item_events_team ON work_item_events(team_id);
CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id),
  name TEXT NOT NULL,
  committed_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS milestone_epics (
  team_id TEXT NOT NULL REFERENCES teams(id),
  milestone_id TEXT NOT NULL REFERENCES milestones(id),
  rank INTEGER NOT NULL,
  epic_id TEXT NOT NULL,
  PRIMARY KEY (milestone_id, rank)
);
`

type Row = Record<string, SQLInputValue>

/** Opens (creating if needed) the SQLite file at `file`. `':memory:'` keeps everything in memory. */
export function openSqliteStorage(file: string): Storage {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(SCHEMA)

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

  const upsertItem = db.prepare(`
    INSERT INTO work_items (id, team_id, source_key, type, title, parent_id, labels, created_at, started_at, done_at, cancelled_at, last_synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      team_id = excluded.team_id, source_key = excluded.source_key, type = excluded.type, title = excluded.title,
      parent_id = excluded.parent_id, labels = excluded.labels, created_at = excluded.created_at,
      started_at = excluded.started_at, done_at = excluded.done_at, cancelled_at = excluded.cancelled_at,
      last_synced_at = excluded.last_synced_at`)
  const insertEvent = db.prepare(`
    INSERT INTO work_item_events (team_id, item_id, at, kind, from_value, to_value)
    VALUES ((SELECT team_id FROM work_items WHERE id = ?), ?, ?, ?, ?, ?)`)
  const upsertMilestone = db.prepare(`
    INSERT INTO milestones (id, team_id, name, committed_date) VALUES (?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET team_id = excluded.team_id, name = excluded.name, committed_date = excluded.committed_date`)
  const deleteMilestoneEpics = db.prepare('DELETE FROM milestone_epics WHERE milestone_id = ?')
  const insertMilestoneEpic = db.prepare(
    'INSERT INTO milestone_epics (team_id, milestone_id, rank, epic_id) VALUES (?, ?, ?, ?)',
  )

  return {
    isEmpty() {
      return db.prepare('SELECT 1 FROM teams LIMIT 1').get() === undefined
    },

    saveTeam(team) {
      db.prepare(
        `INSERT INTO teams (id, name, source, source_ref) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET name = excluded.name, source = excluded.source, source_ref = excluded.source_ref`,
      ).run(team.id, team.name, team.source, team.sourceRef)
    },

    teams() {
      return db
        .prepare('SELECT id, name, source, source_ref FROM teams ORDER BY rowid')
        .all()
        .map((row: Row) => ({
          id: String(row.id),
          name: String(row.name),
          source: String(row.source) as Team['source'],
          sourceRef: String(row.source_ref),
        }))
    },

    addFacts(facts) {
      transaction(() => {
        for (const item of facts.workItems) {
          upsertItem.run(
            item.id,
            item.teamId,
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
          insertEvent.run(event.itemId, event.itemId, event.at, event.kind, event.from ?? null, event.to ?? null)
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
        deleteMilestoneEpics.run(milestone.id)
        milestone.epicIds.forEach((epicId, rank) =>
          insertMilestoneEpic.run(milestone.teamId, milestone.id, rank, epicId),
        )
      })
    },

    milestones(teamId) {
      const epics = db.prepare('SELECT epic_id FROM milestone_epics WHERE milestone_id = ? ORDER BY rank')
      return db
        .prepare('SELECT id, team_id, name, committed_date FROM milestones WHERE team_id = ? ORDER BY rowid')
        .all(teamId)
        .map(
          (row: Row): Milestone => ({
            id: String(row.id),
            teamId: String(row.team_id),
            name: String(row.name),
            committedDate: String(row.committed_date),
            epicIds: epics.all(String(row.id)).map((epic: Row) => String(epic.epic_id)),
          }),
        )
    },

    close() {
      db.close()
    },
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
