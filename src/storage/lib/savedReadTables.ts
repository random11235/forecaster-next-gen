import type { DatabaseSync } from 'node:sqlite'
import type { SavedRead } from '../../model/savedRead.js'
import type { SavedReadStorage } from '../storage.js'
import type { Row, Transaction } from './sqliteDatabase.js'

/*
 * The team's saved reads in the SQLite file, behind sqliteStorage.ts: each query's last read with its tickets in order,
 * and the read it replaced as its previous one.
 */

/** Each query's last read and previous read, kept in the SQLite file `db`. */
export function savedReadTables(db: DatabaseSync, transaction: Transaction): SavedReadStorage {
  const deleteSavedRead = db.prepare('DELETE FROM saved_reads WHERE team_id = ? AND query = ?')
  const insertSavedRead = db.prepare('INSERT INTO saved_reads (team_id, query, incomplete, read_at, finished_since) VALUES (?, ?, ?, ?, ?)')
  const insertSavedReadTicket = db.prepare('INSERT INTO saved_read_tickets (team_id, query, position, id, finished_at) VALUES (?, ?, ?, ?, ?)')
  const selectSavedRead = db.prepare('SELECT incomplete, read_at, finished_since FROM saved_reads WHERE team_id = ? AND query = ?')
  const selectSavedReadTickets = db.prepare('SELECT id, finished_at FROM saved_read_tickets WHERE team_id = ? AND query = ? ORDER BY position')
  const deletePreviousRead = db.prepare('DELETE FROM previous_reads WHERE team_id = ? AND query = ?')
  const keepPreviousRead = db.prepare(
    'INSERT INTO previous_reads (team_id, query, incomplete, read_at, finished_since) SELECT team_id, query, incomplete, read_at, finished_since FROM saved_reads WHERE team_id = ? AND query = ?',
  )
  const keepPreviousReadTickets = db.prepare(`
    INSERT INTO previous_read_tickets (team_id, query, position, id, finished_at)
    SELECT team_id, query, position, id, finished_at FROM saved_read_tickets WHERE team_id = ? AND query = ?`)
  const selectPreviousRead = db.prepare('SELECT incomplete, read_at, finished_since FROM previous_reads WHERE team_id = ? AND query = ?')
  const selectPreviousReadTickets = db.prepare('SELECT id, finished_at FROM previous_read_tickets WHERE team_id = ? AND query = ? ORDER BY position')

  return {
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
      const row = selectSavedRead.get(teamId, query)
      return row && readRow(row, selectSavedReadTickets.all(teamId, query))
    },

    previousRead({ teamId, query }) {
      const row = selectPreviousRead.get(teamId, query)
      return row && readRow(row, selectPreviousReadTickets.all(teamId, query))
    },
  }
}

/** A saved, previous or drafted read from its row and its tickets' rows. */
export function readRow(row: Row, tickets: Row[]): SavedRead {
  return {
    tickets: tickets.map((ticket) => ({
      id: String(ticket.id),
      ...(ticket.finished_at !== null && { finishedAt: String(ticket.finished_at) }),
    })),
    incomplete: Number(row.incomplete) === 1,
    readAt: String(row.read_at),
    finishedSince: String(row.finished_since),
  } satisfies SavedRead
}
