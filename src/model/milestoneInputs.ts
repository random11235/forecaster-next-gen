import type { ThroughputRange } from '../engine/index.js'
import type { Ambiguity } from './ambiguity.js'

/** Which pace the forecast uses: the EM's low–high range, or their typed counts of past periods. */
export type PaceMode = 'range' | 'counts'

/**
 * The milestone as the EM enters it on the Inputs screen, one per team. Every field the MVP forecasts from is here,
 * with its default, so later inputs need no schema change.
 */
export interface MilestoneInputs {
  teamId: string
  name: string
  /** ISO calendar date work starts, `YYYY-MM-DD`; undefined only for a milestone kept from before the MVP. */
  startDate: string | undefined
  /** Whole tickets left today; undefined only for a milestone kept from before the MVP. */
  ticketsRemaining: number | undefined
  /** Unused until the EM can choose one level for the whole milestone (#88): the forecast grows it by the medium range. */
  ambiguity: Ambiguity
  /** Days in one of the team's periods: 7 is a week, anything else a sprint. */
  cadenceDays: number
  paceMode: PaceMode
  /** Whole tickets per period, low ≤ high, once entered. */
  paceRange: ThroughputRange | undefined
  /** Tickets done in past periods, oldest first. */
  paceCounts: number[]
}
