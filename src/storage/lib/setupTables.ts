import type { DatabaseSync } from 'node:sqlite'
import { PACE_MODES, type PaceMode, type TicketsSource } from '../../model/milestoneInputs.js'
import type { FailedRead, FailedReads, ReadFailures } from '../../model/readFailures.js'
import type { SetupDraft } from '../../model/setupDraft.js'
import type { SetupClosed, SetupState, SetupStorage } from '../storage.js'
import { picksIn, picksKept } from './milestoneQueryTables.js'
import { readRow } from './savedReadTables.js'
import type { Row, Transaction } from './sqliteDatabase.js'

/*
 * The team's setup in the SQLite file, behind sqliteStorage.ts: where it stands, its setup draft with the draft's reads,
 * their tickets and its picks' failures in rows of their own, and why the last reads failed. The draft's edits over
 * these rows are setupDraft.ts's.
 */

/** Where the team's setup stands, its draft, and why its reads failed, kept in the SQLite file `db`. */
export function setupTables(db: DatabaseSync, transaction: Transaction): Omit<SetupStorage, 'saveDraftSources' | 'saveDraftPickFailures'> {
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
        ...(row.milestone_query !== null && {
          milestoneQuery: { picks: picksIn(String(row.milestone_picks), 'setup_drafts.milestone_picks'), query: String(row.milestone_query) },
        }),
        ...(row.comparable_work_query !== null && {
          comparableWorkQuery: {
            picks: picksIn(String(row.comparable_work_picks), 'setup_drafts.comparable_work_picks'),
            query: String(row.comparable_work_query),
          },
        }),
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
