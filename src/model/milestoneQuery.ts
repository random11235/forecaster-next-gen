import type { Choice } from './choice.js'

/**
 * What picks out the milestone's tickets in its tracker (#157): the EM's picks, in the order picked, and the milestone
 * query they were joined into, or the EM wrote by hand. A hand-edited query is kept as written; whether the picker can
 * show it is worked out from the picks, not stored.
 */
export interface MilestoneQuery {
  picks: Choice[]
  /** The milestone query, in the tracker's syntax. */
  query: string
}
