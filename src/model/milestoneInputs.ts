import type { ThroughputRange } from '../engine/index.js'
import type { Ambiguity } from './ambiguity.js'

/** Which pace the forecast uses: the EM's low–high range, or their typed counts of past periods. */
export type PaceMode = 'range' | 'counts'

export const PACE_MODES: readonly PaceMode[] = ['range', 'counts']

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
  /** One level for the whole milestone, medium until the EM chooses: the forecast grows it by that level's range. */
  ambiguity: Ambiguity
  /** Days in one of the team's periods: 7 is a week, anything else a sprint. */
  cadenceDays: number
  paceMode: PaceMode
  /** Whole tickets per period, low ≤ high, once entered. */
  paceRange: ThroughputRange | undefined
  /** Tickets done in past periods, oldest first. */
  paceCounts: number[]
  /** The cadence the pace range or typed counts were last entered in; undefined until either is. */
  paceCadenceDays: number | undefined
  /** Which of the counts the pace is drawn from. */
  paceWindow: PaceWindow
}

/**
 * The periods the pace is drawn from: every count, unless the EM applied a pace pattern's action. Counts outside the
 * window are kept, not deleted, so undoing the action brings them back.
 */
export interface PaceWindow {
  action: PaceAction | undefined
}

/**
 * A pace pattern's action, applied: count pace from the period starting on `date`, after a step, or leave out the
 * period starting on `date`, an odd one.
 */
export interface PaceAction {
  kind: 'startFrom' | 'leaveOut'
  /** ISO calendar date the period starts, `YYYY-MM-DD`. */
  date: string
}
