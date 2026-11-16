import type { ThroughputRange } from '../engine/index.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import { PACE_MODES, type MilestoneInputs, type PaceMode, type TicketsSource } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { periodName } from './cadence.js'
import { isCalendarDate } from './calendarDate.js'
import { refuse, type EditResult, type Refusal } from './editResult.js'
import { sameCounts, type PaceReading, type WasPace } from './lib/pace.js'
import { assessMilestone, type InputNote, type MilestoneAssessment } from './milestoneAssessment.js'
import { paceTrend, type PaceTrend } from './paceTrend.js'
import type { ForecastSettings } from './settings.js'
import { milestonePace, paceReadingView, type Measured, type PaceReadingView, type TicketsReading, type WasTickets } from './trackerReads.js'

/** Far above any real team's pace in one period; keeps typos like 1000000 out of the forecast. */
export const MAX_TICKETS_PER_PERIOD = 1000

/** Far above any real team's sprint; keeps typos out of the forecast, and its 156-period horizon within the calendar. */
export const MAX_CADENCE_DAYS = 365

/** Far above any real milestone; keeps typos out of the forecast. */
export const MAX_TICKETS_REMAINING = 100_000

/** A change the EM makes to the milestone on the Inputs screen, as typed. */
export type MilestoneInputsEdit =
  /**
   * Tickets remaining typed switches it to typed. It is undefined when the form has no field for it, as while it follows
   * the tracker; it then follows on.
   */
  | { kind: 'setMilestone'; name: string; startDate: string; ticketsRemaining: string | undefined }
  /** Where tickets remaining comes from, `tracker` or `typed`; the typed number is kept either way. */
  | { kind: 'setTicketsSource'; ticketsSource: string }
  /** Whole tickets per period, low ≤ high. */
  | { kind: 'setPaceRange'; low: string; high: string }
  /** One level for the whole milestone: `low`, `medium` or `high`. */
  | { kind: 'setAmbiguity'; level: string }
  /** Whole days in one of the team's periods, 1 or more. */
  | { kind: 'setCadence'; cadenceDays: string }
  /** The typed counts as a list: whole tickets done in each past period, oldest first, apart by commas or spaces. */
  | { kind: 'setPaceCounts'; counts: string }
  /** One more typed count, the newest: whole tickets done in the period just past. */
  | { kind: 'addPaceCount'; count: string }
  /** Drops the newest typed count, if there is one. */
  | { kind: 'removeLastPaceCount' }
  /**
   * Which pace the forecast uses: `range`, `counts`, or with a connection `tracker`; each is kept. Typing the counts
   * while following the tracker switches pace to typed counts.
   */
  | { kind: 'setPaceMode'; paceMode: string }
  /**
   * The EM opened the tracker's latest reading of a value, `ticketsRemaining` or `pace`, from its chip: its dot clears
   * until the next read.
   */
  | { kind: 'openReading'; reading: string }

/** The milestone as the Inputs screen shows it, with the start date pre-filled with today until one is entered. */
export interface MilestoneInputsView {
  name: string
  startDate: string
  /** As typed: kept while the tracker's is used. */
  ticketsRemaining: number | undefined
  /** Where tickets remaining comes from; none with no connection, where it is typed, as in the MVP. */
  ticketsSource: TicketsSourceView | undefined
  /** How well the work is understood: medium until the EM chooses. */
  ambiguity: Ambiguity
  /** Days in one of the team's periods, which pace is entered in. */
  cadenceDays: number
  paceRange: ThroughputRange | undefined
  /** Tickets done in past periods, oldest first. */
  paceCounts: number[]
  /** Which pace the EM chose. */
  paceMode: PaceMode
  /** Which pace the forecast uses: the one chosen, but typed counts while following the tracker with no connection. */
  paceUsed: PaceMode
  /** What the tracker reads of pace, with a connection to follow it; none with none, where pace is typed or a range. */
  trackerPace: TrackerPaceView | undefined
  /** How many typed counts the settings need: at least `forForecast` for a forecast, and `reliable` to be reliable. */
  typedCountsNeeded: ForecastSettings['typedCounts']
  /** What stops a forecast, then the warnings, each beside its input; none before anything is entered. */
  notes: InputNote[]
  /** The typed counts in use and their fitted line, shown beside them; none with the range or too few counts. */
  paceTrend: PaceTrend | undefined
}

/** Where tickets remaining comes from, with a connection to choose the tracker from. */
export interface TicketsSourceView {
  source: TicketsSource
  /** The connected tracker, which the sources and their wording name: GitHub or Jira. */
  tracker: string
  /** The tracker's latest reading, which tickets remaining is while it follows the tracker; none until it is read. */
  reading: TicketsReading | undefined
  /** While it follows the tracker, the value its latest read replaced, shown faintly; none otherwise. */
  was: WasTickets | undefined
  /** Typed and different from the reading: the chip saying the tracker reads it differently. None otherwise. */
  readsDifferently: ReadsDifferently | undefined
}

/** The chip on a typed value that the tracker's latest reading differs from, which opens the reading and offers Follow. */
export interface ReadsDifferently {
  /** The EM hasn't opened this reading yet: the chip carries a dot. */
  unseen: boolean
}

/** The connected tracker's pace, offered as a source of pace. */
export interface TrackerPaceView {
  /** The connected tracker, which the source and its wording name: GitHub or Jira. */
  tracker: string
  /** The tracker's reading of pace, which the forecast uses while pace follows it; none until it is read. */
  reading: PaceReadingView | undefined
  /** No reading, as a read pace would come from is incomplete: marked so, not as unread. */
  incomplete: boolean
  /** While pace follows the tracker, the counts its latest read replaced, shown faintly; none otherwise. */
  was: WasPace | undefined
  /** The typed counts or the range in use, different from the reading: the chip. None otherwise. */
  readsDifferently: ReadsDifferently | undefined
}

/**
 * The milestone's inputs as the Inputs screen shows them: blank, but for the start date, until the EM enters one. With
 * a connection, `measured` is what the tracker reads.
 */
export function milestoneInputsView(storage: Storage, teamId: string, settings: ForecastSettings, today: string, measured?: Measured): MilestoneInputsView {
  const saved = storage.milestoneInputs(teamId)
  const inputs = saved ?? newMilestone(teamId)
  const pace = milestonePace(inputs, today, measured, settings)
  const assessment = saved && assessMilestone(saved, today, pace, measured)
  return {
    name: inputs.name,
    startDate: inputs.startDate ?? today,
    ticketsRemaining: inputs.ticketsRemaining,
    ticketsSource: measured && {
      source: inputs.ticketsSource,
      tracker: measured.tracker,
      reading: measured.ticketsRemaining,
      was: inputs.ticketsSource === 'tracker' ? measured.ticketsRemaining?.was : undefined,
      readsDifferently: ticketsReadDifferently(inputs, measured.ticketsRemaining),
    },
    ambiguity: inputs.ambiguity,
    cadenceDays: inputs.cadenceDays,
    paceRange: inputs.paceRange,
    paceCounts: inputs.paceCounts,
    paceMode: inputs.paceMode,
    paceUsed: pace.inUse.source,
    trackerPace: measured && {
      tracker: measured.tracker,
      reading: pace.reading && paceReadingView(pace.reading),
      incomplete: pace.incomplete,
      was: inputs.paceMode === 'tracker' ? pace.reading?.was : undefined,
      readsDifferently: paceReadDifferently(inputs, pace.reading),
    },
    typedCountsNeeded: settings.typedCounts,
    notes: assessment ? notesBeside(assessment) : [],
    paceTrend: paceTrend(pace.inUse, settings, inputs.startDate),
  }
}

/** Tickets remaining typed, and different from the tracker's latest reading: its chip, dotted until that read is opened. */
function ticketsReadDifferently(inputs: MilestoneInputs, reading: TicketsReading | undefined): ReadsDifferently | undefined {
  if (!reading || inputs.ticketsSource !== 'typed' || inputs.ticketsRemaining === reading.count) return undefined
  return { unseen: inputs.seenReads.ticketsRemaining !== reading.readAt }
}

/**
 * The typed counts or the range in use, and different from the tracker's reading of pace: its chip, dotted until that
 * read is opened. Typed counts differ unless they are the reading's counts; a range, unless it spans them, from the
 * slowest period to the best. A reading with no periods counted has nothing to follow.
 */
function paceReadDifferently(inputs: MilestoneInputs, reading: PaceReading | undefined): ReadsDifferently | undefined {
  const counts = reading?.window.counts ?? []
  if (!reading || counts.length === 0 || inputs.paceMode === 'tracker') return undefined
  const same =
    inputs.paceMode === 'counts'
      ? sameCounts(inputs.paceCounts, counts)
      : inputs.paceRange?.low === Math.min(...counts) && inputs.paceRange.high === Math.max(...counts)
  return same ? undefined : { unseen: inputs.seenReads.pace !== reading.readAt }
}

/** What stops a forecast, then the warnings, each worded as it reads beside its input. */
function notesBeside(assessment: MilestoneAssessment): InputNote[] {
  const problems = assessment.forecastable ? [] : assessment.problems
  return [...problems, ...assessment.warnings.map(({ input, beside }) => ({ input, message: beside }))]
}

/**
 * Seam B, through `submitInputs`: saves the EM's edit to the milestone. A refused edit changes nothing and says why.
 * With a connection, `measured` is what the tracker reads on `today`: the tracker is offered as a source only then.
 */
export function editMilestoneInputs(storage: Storage, teamId: string, edit: MilestoneInputsEdit, today: string, measured?: Measured): EditResult {
  const saved = storage.milestoneInputs(teamId)
  if (edit.kind === 'setMilestone') return save(storage, withMilestone(saved ?? newMilestone(teamId), edit))
  if (!saved) return refuse('Enter the milestone first.')
  if (edit.kind === 'setTicketsSource') return save(storage, withTicketsSource(saved, edit.ticketsSource, measured))
  if (edit.kind === 'setPaceMode') return save(storage, withPaceMode(saved, edit.paceMode, measured))
  if (edit.kind === 'openReading') return save(storage, withReadingOpened(saved, edit.reading, today, measured))
  return save(storage, edited(saved, edit))
}

/** The pace the forecast uses: the tracker's only with a connection. */
function withPaceMode(saved: MilestoneInputs, paceMode: string, measured: Measured | undefined): Edited {
  const offered = PACE_MODES.filter((mode) => mode !== 'tracker' || measured)
  const chosen = offered.find((mode) => mode === paceMode)
  if (chosen === undefined) return refuse(measured ? `Choose ${measured.tracker}, typed counts or the range.` : 'Choose the range or typed counts.')
  return { ...saved, paceMode: chosen }
}

/** The milestone with the tracker's latest reading of a value marked opened, so its chip's dot clears until the next read. */
function withReadingOpened(saved: MilestoneInputs, reading: string, today: string, measured: Measured | undefined): Edited {
  if (!measured) return refuse('Connect a tracker to see its reading.')
  if (reading !== 'ticketsRemaining' && reading !== 'pace') return refuse('Choose tickets remaining or pace.')
  const latest = reading === 'pace' ? milestonePace(saved, today, measured).reading : measured.ticketsRemaining
  if (!latest) return refuse(`${measured.tracker} hasn’t read it yet.`)
  return { ...saved, seenReads: { ...saved.seenReads, [reading]: latest.readAt } }
}

/** The source tickets remaining comes from: the tracker only with a connection. */
function withTicketsSource(saved: MilestoneInputs, source: string, measured: Measured | undefined): Edited {
  if (!measured) return source === 'typed' ? { ...saved, ticketsSource: 'typed' } : refuse('Connect a tracker to follow it.')
  if (source !== 'tracker' && source !== 'typed') return refuse(`Choose ${measured.tracker} or typed.`)
  return { ...saved, ticketsSource: source }
}

/** The milestone as an edit leaves it, or why the edit was refused. */
type Edited = MilestoneInputs | Refusal

function save(storage: Storage, inputs: Edited): EditResult {
  if ('error' in inputs) return inputs
  storage.saveMilestoneInputs(inputs)
  return { ok: true }
}

/**
 * The milestone named, dated and with tickets remaining as typed, which switches it to typed. With none typed, it
 * follows the tracker on as it did; a milestone typing its tickets needs them.
 */
function withMilestone(inputs: MilestoneInputs, edit: Extract<MilestoneInputsEdit, { kind: 'setMilestone' }>): Edited {
  const name = edit.name.trim()
  if (name === '') return refuse('Give the milestone a name.')
  if (!isCalendarDate(edit.startDate.trim())) return refuse('Enter the start date as a calendar date.')
  const named = { ...inputs, name, startDate: edit.startDate.trim() }
  if (edit.ticketsRemaining === undefined && inputs.ticketsSource === 'tracker') return named
  const tickets = wholeNumber(edit.ticketsRemaining ?? '')
  if (tickets === undefined) return refuse('Enter tickets remaining as a whole number, 0 or more.')
  if (tickets > MAX_TICKETS_REMAINING) return refuse(`Enter at most ${MAX_TICKETS_REMAINING} tickets remaining.`)
  return { ...named, ticketsRemaining: tickets, ticketsSource: 'typed' }
}

/** A saved milestone as any edit but the milestone's own leaves it. */
function edited(
  saved: MilestoneInputs,
  edit: Exclude<MilestoneInputsEdit, { kind: 'setMilestone' | 'setTicketsSource' | 'setPaceMode' | 'openReading' }>,
): Edited {
  switch (edit.kind) {
    case 'setPaceRange': {
      const [low, high] = [wholeNumber(edit.low), wholeNumber(edit.high)]
      if (low === undefined || high === undefined) return refuse('Enter whole numbers of tickets, 0 or more.')
      if (high > MAX_TICKETS_PER_PERIOD) return refuseAbovePerPeriodCap(saved)
      if (low > high) return refuse('The low end must not be above the high end.')
      return { ...saved, paceRange: { low, high }, paceCadenceDays: saved.cadenceDays }
    }
    case 'setAmbiguity': {
      const level = AMBIGUITIES.find((ambiguity) => ambiguity === edit.level)
      if (level === undefined) return refuse('Choose low, medium or high ambiguity.')
      return { ...saved, ambiguity: level }
    }
    case 'setPaceCounts':
    case 'addPaceCount': {
      const typed = edit.kind === 'addPaceCount' ? [edit.count] : edit.counts.split(/[\s,]+/).filter((count) => count !== '')
      const counts = typed.map(wholeNumber)
      if (!counts.every((count) => count !== undefined)) return refuse('Enter typed counts as whole numbers of tickets, 0 or more.')
      if (counts.some((count) => count > MAX_TICKETS_PER_PERIOD)) return refuseAbovePerPeriodCap(saved)
      const paceCounts = edit.kind === 'addPaceCount' ? [...saved.paceCounts, ...counts] : counts
      // typed while following the tracker, as into its opened weeks: pace switches to the typed counts
      const paceMode = saved.paceMode === 'tracker' ? 'counts' : saved.paceMode
      return { ...saved, paceCounts, paceMode, paceCadenceDays: saved.cadenceDays }
    }
    case 'removeLastPaceCount':
      return { ...saved, paceCounts: saved.paceCounts.slice(0, -1) }
    case 'setCadence': {
      const days = wholeNumber(edit.cadenceDays)
      if (days === undefined || days < 1) return refuse('Enter the cadence as a whole number of days, 1 or more.')
      if (days > MAX_CADENCE_DAYS) return refuse(`Enter a cadence of at most ${MAX_CADENCE_DAYS} days.`)
      return { ...saved, cadenceDays: days }
    }
  }
}

/** Refuses a pace above `MAX_TICKETS_PER_PERIOD` tickets in one period of the milestone's cadence. */
function refuseAbovePerPeriodCap(saved: MilestoneInputs): Refusal {
  return refuse(`Enter at most ${MAX_TICKETS_PER_PERIOD} tickets per ${periodName(saved.cadenceDays)}.`)
}

/** A milestone with every input the EM hasn't entered yet at its default. */
export function newMilestone(teamId: string): MilestoneInputs {
  return {
    teamId,
    name: '',
    startDate: undefined,
    ticketsRemaining: undefined,
    ticketsSource: 'typed',
    ambiguity: 'medium',
    cadenceDays: 7,
    paceMode: 'range',
    paceRange: undefined,
    paceCounts: [],
    paceCadenceDays: undefined,
    paceWindow: { action: undefined, skippedPeriods: [] },
    seenReads: { ticketsRemaining: undefined, pace: undefined },
  }
}

/** The typed value as a whole number, 0 or more, or undefined if it isn't one. */
function wholeNumber(typed: string): number | undefined {
  const trimmed = typed.trim()
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined
}
