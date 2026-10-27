import type { ForecastResult } from '../engine/index.js'
import type { MilestoneEpic } from './milestoneEpics.js'

/**
 * Pace variation (relative standard error) bands. Split-halves' 25% and 75% bands correspond to about 15% and 44%
 * RSE (split-halves ≈ 1.70 × RSE): see
 * https://github.com/random11235/forecaster-next-gen/blob/main/docs/research/pace-stability/README.md#split-halves-error-is-the-relative-standard-error
 */
/**
 * Where an epic's growth is drawn from: the team's measured growth samples, its ambiguity level's range, or, with no
 * baseline children, a whole-epic size.
 */
export type GrowthSource = 'samples' | 'ambiguity' | 'epicSize'

const STEADY_BELOW = 0.15
const VARIES_A_LOT_FROM = 0.44

/**
 * Information notes for the EM, from the engine's diagnostics. These are never warnings: lumpy weeks give a wide
 * range that still holds up.
 */
export function informationNotes(result: ForecastResult): string[] {
  const { paceVariation } = result.diagnostics
  return paceVariation === undefined ? [] : [paceVariationNote(paceVariation)]
}

/**
 * Warnings about the milestone's epics, in rank order, at most one per epic, and none once an epic is done or cancelled:
 * - an epic still carrying the commit label, with no commit standing since a pull-back reset its label
 *   commit: the label commits only when applied, so the EM commits it in the tool or takes the label off and puts it
 *   back;
 * - an epic in progress (by its own status) with no commit standing, since an epic never committed never produces a
 *   growth sample;
 * - an epic committed by the commit label that has since lost it, for the EM to put the label back or remove the epic
 *   from the milestone.
 * Blocked epics are flagged on their row.
 */
export function epicWarnings(epics: readonly MilestoneEpic[], commitLabel: string | undefined): string[] {
  return epics.flatMap((epic) => {
    if (epic.finished) return []
    if (epic.labelCommitReset && !epic.commit) {
      return [
        `${epic.name} has the “${commitLabel ?? ''}” label but isn't committed: it moved back to not started after the ` +
          'label went on. Commit it on Inputs, or take the label off and put it back.',
      ]
    }
    if (epic.inProgress && !epic.commit) return [`${epic.name} is in progress but isn't committed`]
    if (epic.commit?.source === 'label' && epic.commit.labelRemoved) {
      return [`${epic.name} is committed but no longer has the “${commitLabel ?? ''}” label`]
    }
    return []
  })
}

/** Says plainly why measured pace gives no forecast yet. */
export function thinDataMessage(reason: 'noDoneTickets'): string {
  switch (reason) {
    case 'noDoneTickets':
      return "No tickets in this milestone's epics are done yet, so there is no measured pace to forecast from."
  }
}

function paceVariationNote(relativeStandardError: number): string {
  if (relativeStandardError < STEADY_BELOW) return 'Your weekly pace is steady, so the range is narrow.'
  if (relativeStandardError < VARIES_A_LOT_FROM) return 'Your weekly pace varies, so the range is wider.'
  return 'Your weekly pace varies a lot, so the range is wide.'
}
