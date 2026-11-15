import type { PaceMode, TicketsSource } from './milestoneInputs.js'
import type { MilestoneQuery } from './milestoneQuery.js'
import type { FailedReads } from './readFailures.js'
import type { SavedRead } from './savedRead.js'

/**
 * What the EM has chosen inside setup and not yet applied (#218): the Milestone and Comparable work steps' picks and
 * queries, each only once changed there; the reads made there, latest only; the source Check chose for each value
 * (#220), once chosen there; and why a pick's own read at Check failed (#222). Nothing in it reaches the forecast, the
 * Inputs values or the summary until "Use these" applies it all together; Cancel throws it away.
 */
export interface SetupDraft {
  milestoneQuery?: MilestoneQuery
  comparableWorkQuery?: MilestoneQuery
  /**
   * Each query read inside setup, with its latest read there. Kept by the query read, as the saved reads are: a step's
   * query and its lone pick's are one query, read once.
   */
  reads: { query: string; read: SavedRead }[]
  /** The sources chosen at Check, each only once chosen there. */
  sources?: { ticketsRemaining?: TicketsSource; pace?: PaceMode }
  /** Each pick whose own read at Check failed, by the pick's query: the summary says so once applied. */
  pickFailures?: FailedReads
}
