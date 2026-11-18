import type { DatabaseSync } from 'node:sqlite'
import { choiceKindOf, type Choice } from '../../connectors/connector.js'
import type { MilestoneQuery } from '../../model/milestoneQuery.js'
import type { MilestoneQueryStorage } from '../storage.js'
import type { Row } from './sqliteDatabase.js'

/*
 * The milestone query and comparable work's in the SQLite file, behind sqliteStorage.ts: each its picks, in order, and
 * its query, replaced together; and the picks as a row keeps them, which the setup draft's rows keep too.
 */

/** The milestone's picks and query and comparable work's, kept in the SQLite file `db`. */
export function milestoneQueryTables(db: DatabaseSync): MilestoneQueryStorage {
  const upsertMilestoneQuery = db.prepare(`
    INSERT INTO milestone_queries (team_id, query, picks) VALUES (?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET query = excluded.query, picks = excluded.picks`)
  const selectMilestoneQuery = db.prepare('SELECT query, picks FROM milestone_queries WHERE team_id = ?')
  const upsertComparableWorkQuery = db.prepare(`
    INSERT INTO comparable_work_queries (team_id, query, picks) VALUES (?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET query = excluded.query, picks = excluded.picks`)
  const selectComparableWorkQuery = db.prepare('SELECT query, picks FROM comparable_work_queries WHERE team_id = ?')

  return {
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
  }
}

/** The picks as a row keeps them: a JSON array of each one's kind, name and query, in order, and nothing else of it. */
export function picksKept(picks: readonly Choice[]): string {
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
export function picksIn(json: string): Choice[] {
  const stored = JSON.parse(json) as { kind: string; name: string; query: string }[]
  return stored.flatMap(({ kind, name, query }) => {
    const known = choiceKindOf(kind)
    return known ? [{ kind: known, name, query }] : []
  })
}
