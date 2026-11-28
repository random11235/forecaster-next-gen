import type { ThroughputRange } from '../engine/index.js'
import type { Ambiguity } from './ambiguity.js'
import type { NoneMissing } from './noneMissing.js'

/**
 * Which pace the forecast uses, the pace's source: the EM's low–high range, their typed counts of past periods, or the
 * tracker's measured counts (offered only with a connection, #159).
 */
export type PaceMode = 'range' | 'counts' | 'tracker'

export const PACE_MODES: readonly PaceMode[] = ['range', 'counts', 'tracker']

/** Where tickets remaining comes from: the tracker's reading of the milestone, or the EM's typed number (#159). */
export type TicketsSource = 'tracker' | 'typed'

export const TICKETS_SOURCES = ['tracker', 'typed'] as const satisfies readonly TicketsSource[]

// fails to compile while TICKETS_SOURCES leaves out a tickets source
export type TicketsSourcesComplete = NoneMissing<Exclude<TicketsSource, (typeof TICKETS_SOURCES)[number]>>

/**
 * The milestone as the EM enters it on the Inputs screen, one per team. Every field the MVP forecasts from is here,
 * with its default, so later inputs need no schema change.
 */
export interface MilestoneInputs {
  teamId: string
  name: string
  /** ISO calendar date work starts, `YYYY-MM-DD`; undefined only for a milestone kept from before the MVP. */
  startDate: string | undefined
  /** Whole tickets left today, as typed; undefined only for a milestone kept from before the MVP. */
  ticketsRemaining: number | undefined
  /**
   * Where the forecast's tickets remaining comes from: typed until the EM chooses the tracker. The typed number is kept
   * while the tracker's is used, so switching back restores it.
   */
  ticketsSource: TicketsSource
  /** One level for the whole milestone, medium until the EM chooses: the forecast grows it by that level's range. */
  ambiguity: Ambiguity
  /** Days in one of the team's periods: 7 is a week, anything else a sprint. */
  cadenceDays: number
  paceMode: PaceMode
  /** Whole tickets per period, low ≤ high, once entered. */
  paceRange: ThroughputRange | undefined
  /** Tickets done in past periods, oldest first. */
  paceCounts: number[]
  /** Which of the counts the pace is drawn from. */
  paceWindow: PaceWindow
  /** Which of each value's tracker readings the EM has opened, so an unseen latest read can be marked. */
  seenReads: SeenReads
}

/**
 * The tracker reading of each value the EM last opened, as that read's `readAt` instant; undefined until they open one.
 * The latest read is unseen while its `readAt` differs.
 */
export interface SeenReads {
  ticketsRemaining: string | undefined
  pace: string | undefined
}

/**
 * The periods the pace is drawn from: every count, unless the EM applied a pace pattern's action. Counts outside the
 * window are kept, not deleted, so undoing the action brings them back.
 */
export interface PaceWindow {
  action: PaceAction | undefined
  /**
   * The tracker's periods the EM skipped, by the ISO calendar date each starts on, `YYYY-MM-DD`: the measured pace
   * reaches back past them. They belong to the milestone and outlast reads (#159).
   */
  skippedPeriods: string[]
}

/**
 * A pace pattern's action, applied: count pace from the period starting on `date`, after a step, or leave out
 * `period`, an odd one. Both are ISO calendar dates a period starts on, `YYYY-MM-DD`.
 */
export type PaceAction = { kind: 'startFrom'; date: string } | { kind: 'leaveOut'; period: string }
