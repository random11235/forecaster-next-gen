import type { MilestoneQuery } from './milestoneQuery.js'
import type { SavedRead } from './savedRead.js'

/**
 * What the EM has chosen inside setup and not yet applied (#218): the Milestone and Comparable work steps' picks and
 * queries, each only once changed there, and the reads made of queries there, latest only. Nothing in it reaches the
 * forecast or the Inputs values until "Use these" applies it all together; Cancel throws it away.
 */
export interface SetupDraft {
  milestoneQuery?: MilestoneQuery
  comparableWorkQuery?: MilestoneQuery
  /** Each query read inside setup, with its latest read there. */
  reads: { query: string; read: SavedRead }[]
}
