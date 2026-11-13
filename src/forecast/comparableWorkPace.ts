import type { SavedRead } from '../model/savedRead.js'
import { periodName } from './cadence.js'
import { finishedPerPeriod, ticketsRemaining } from './finished.js'
import type { PeriodName } from './cadence.js'
import { paceReads, type PaceDay, type PaceFrom, type PaceReadsStorage } from './paceReads.js'
import { medianOf, paceVersusMilestoneOwn, type PaceVersus } from './paceVersusOwn.js'

/** The pace in use: where it comes from, and its median and range a period. */
export interface PaceInUse {
  from: PaceFrom
  median: number
  low: number
  high: number
}

/** One period, as the step pairs it: the milestone's own finished tickets beside comparable work's, if it has a query. */
export interface PairedPeriod {
  /** The period's first day. */
  start: string
  /** None while the milestone query's read is incomplete. */
  milestone?: number
  /** None with no comparable-work query, or no complete read of it. */
  comparableWork?: number
  /** The period comes before the milestone's start date, so its own count isn't its pace. */
  beforeStart: boolean
}

/** One of comparable work's picks, by its own read: what its chip shows. */
export interface PickPace {
  /** The pick's query, which names it among the picks. */
  query: string
  /** Its finished tickets in each of the periods paired. */
  strip: number[]
  /** How many it finished in the weeks its read reaches back. */
  finished: number
  /** With several picks, how many of those no other pick's read has. */
  onlyHere?: number
}

/** How many periods the step pairs, the most recent. */
export const PAIRED_PERIODS = 8

/** How the pace in use compares with the milestone's own so far: `versus` it, over how many periods of its own, at what median. */
export interface OwnComparison {
  versus: PaceVersus
  ownPeriods: number
  /** None when the milestone has no period of its own yet. */
  ownMedian?: number
}

/**
 * What the Comparable work step leads with: the pace in use, and how far it is from the milestone's own so far, each
 * also as the step says it.
 */
export interface ComparableWorkPace {
  /** None until pace has a period to count. */
  inUse?: PaceInUse
  /** How the pace in use compares with the milestone's own; none when it is the milestone's own, or that is unknown. */
  comparison?: OwnComparison
  /** The last `PAIRED_PERIODS` whole periods the reads reach, oldest first. */
  periods: PairedPeriod[]
  /** Comparable work's picks, in the order picked, each that has a complete read of its own. */
  picks: PickPace[]
  said: {
    /** "2 a week". */
    inUse?: string
    /** "pace, from comparable work, range 1–2". */
    from?: string
    /** "↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)". */
    comparison?: string
  }
}

/**
 * Seam B: the Comparable work step's pace, from the team's saved reads (`paceReads`), asking the tracker nothing.
 * None before the milestone has a start date and a complete read of its query.
 */
export function comparableWorkPace(storage: PaceReadsStorage, teamId: string, day: PaceDay): ComparableWorkPace | undefined {
  const reads = paceReads(storage, teamId, day)
  const inputs = storage.milestoneInputs(teamId)
  if (!reads || !inputs) return undefined
  const period = periodName(inputs.cadenceDays)
  const counts = reads.pace.counts
  const inUse: PaceInUse | undefined =
    counts.length === 0 ? undefined : { from: reads.from, median: medianOf(counts), low: Math.min(...counts), high: Math.max(...counts) }
  const own = reads.milestone?.counts.slice(reads.beforeStart) ?? []
  const comparison: OwnComparison | undefined =
    inUse && reads.from === 'comparableWork' && reads.milestone
      ? { versus: paceVersusMilestoneOwn(inUse.median, own), ownPeriods: own.length, ...(own.length > 0 && { ownMedian: medianOf(own) }) }
      : undefined
  const { milestone, comparableWork, beforeStart } = reads
  // the milestone's own read, or else comparable work's, lays out the periods; both reads are laid the same
  const laid = (milestone ?? comparableWork)!
  const periods = laid.starts.map((start, at) => ({
    start,
    ...(milestone && { milestone: milestone.counts[at]! }),
    ...(comparableWork && { comparableWork: comparableWork.counts[at]! }),
    beforeStart: at < beforeStart,
  }))
  return {
    ...(inUse && { inUse }),
    ...(comparison && { comparison }),
    periods: periods.slice(-PAIRED_PERIODS),
    picks: picksPace(storage, teamId, (read) => finishedPerPeriod(read, { ...inputs, ...day, startDate: inputs.startDate!, periods: periods.length }).counts.slice(-PAIRED_PERIODS)),
    said: {
      ...(inUse && { inUse: perPeriod(inUse.median, period), from: `pace, from ${FROM_SAID[inUse.from]}, range ${range(inUse)}` }),
      ...(comparison && { comparison: comparisonSaid(comparison, period) }),
    },
  }
}

/** The comparison as the step says it: "↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)". */
function comparisonSaid({ versus, ownPeriods, ownMedian = 0 }: OwnComparison, period: PeriodName): string {
  switch (versus.kind) {
    case 'tooFewToCompare':
      return `The milestone has ${ownPeriods} ${period}${ownPeriods === 1 ? '' : 's'} of its own so far: too few to compare.`
    case 'aboutTheSame':
      return `About the same as the milestone’s own so far (${perPeriod(ownMedian, period)}).`
    default:
      return `${versus.kind === 'faster' ? '↑' : '↓'} ${perPeriod(versus.by, period)} ${versus.kind} than the milestone’s own so far (${perPeriod(ownMedian, period)})`
  }
}

/** A number of tickets a period, to one decimal place: "1.5 a week". */
function perPeriod(tickets: number, period: PeriodName): string {
  return `${Math.round(tickets * 10) / 10} a ${period}`
}

const FROM_SAID: Readonly<Record<PaceFrom, string>> = { comparableWork: 'comparable work', milestone: 'the milestone’s own tickets' }

/** "1–2", or "2" when the range is one count. */
function range({ low, high }: PaceInUse): string {
  return low === high ? `${low}` : `${low}–${high}`
}

/** Each of comparable work's picks with a complete read of its own, with its `strip` of the periods paired. */
function picksPace(storage: PaceReadsStorage, teamId: string, strip: (read: SavedRead) => number[]): PickPace[] {
  const picks = storage.comparableWorkQuery(teamId)?.picks ?? []
  const read = picks.flatMap((pick) => {
    const saved = storage.savedRead({ teamId, query: pick.query })
    return saved && !saved.incomplete ? [{ query: pick.query, read: saved }] : []
  })
  return read.map(({ query, read: own }) => {
    const elsewhere = new Set(read.filter((other) => other.query !== query).flatMap((other) => other.read.tickets.map((ticket) => ticket.id)))
    const finished = own.tickets.filter((ticket) => ticket.finishedAt !== undefined)
    return {
      query,
      strip: strip(own),
      finished: own.tickets.length - ticketsRemaining(own),
      ...(picks.length > 1 && { onlyHere: finished.filter((ticket) => !elsewhere.has(ticket.id)).length }),
    }
  })
}
