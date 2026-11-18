import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

// Writing to and reading from a SQLite file straight, past storage, for the Storage contract's cases on stored data
// storage can't write (storageContract.storedShape.test.ts, storageContract.unknownValues.test.ts), so the direct
// writes stay in one place. Every other test arranges through storage's own functions (arrangeRules.test.ts).

/** Runs `sql` with `values` on the SQLite file at `file`, as a later version or a damaged file would leave it. */
export function writeStraight(file: string, sql: string, ...values: SQLInputValue[]): void {
  const db = new DatabaseSync(file)
  try {
    db.prepare(sql).run(...values)
  } finally {
    db.close()
  }
}

/** The first row `sql` reads from the SQLite file at `file`, as kept there, if any. */
export function readStraight(file: string, sql: string): Record<string, unknown> | undefined {
  const db = new DatabaseSync(file)
  try {
    return db.prepare(sql).get()
  } finally {
    db.close()
  }
}
