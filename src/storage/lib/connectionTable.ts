import type { DatabaseSync } from 'node:sqlite'
import type { ConnectionStorage } from '../storage.js'

/* The team's connection in the SQLite file, behind sqliteStorage.ts: at most one a team, to GitHub or to Jira. */

/** The team's connection, kept in the SQLite file `db`. */
export function connectionTable(db: DatabaseSync): ConnectionStorage {
  const upsertConnection = db.prepare(`
    INSERT INTO connections (team_id, tracker, owner, repo, site, project_key, email) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      tracker = excluded.tracker, owner = excluded.owner, repo = excluded.repo, site = excluded.site,
      project_key = excluded.project_key, email = excluded.email`)
  const selectConnection = db.prepare('SELECT * FROM connections WHERE team_id = ?')
  const deleteConnection = db.prepare('DELETE FROM connections WHERE team_id = ?')

  return {
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
  }
}
