import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

/*
 * The SQLite file, behind sqliteStorage.ts, as each part of its storage in lib/ reads and writes it: the open database,
 * its rows, and a transaction over it.
 */

/** A row as SQLite reads it back: each column's value, by name. */
export type Row = Record<string, SQLInputValue>

/** Runs `work` in one transaction: all of it kept, or, if it throws, none of it. */
export type Transaction = (work: () => void) => void

/** Opens (creating if needed) the SQLite file at `file`, with foreign keys on. `':memory:'` keeps everything in memory. */
export function openDatabase(file: string): { db: DatabaseSync; transaction: Transaction } {
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
  return { db, transaction }
}
