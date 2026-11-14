import type { MilestoneInputs, PaceAction } from '../model/milestoneInputs.js'
import type { Storage } from '../storage/storage.js'
import { periodName, type PeriodName } from './cadence.js'
import { dayMonth, isCalendarDate } from './calendarDate.js'
import { refuse, type EditResult } from './editResult.js'
import { actionSaid, paceWindow, withAction, type DatedCounts } from './paceWindow.js'
import type { Measured } from './trackerReads.js'

// The rule is the research classifier's, trimmed (docs/research/pace-stability/classify.mjs).

/** The shapes the tool names in the counts the pace comes from. */
export type PacePatternName =
  | 'steady'
  | 'lumpy'
  | 'speedingUp'
  | 'slowingDown'
  | 'steppedUp'
  | 'steppedDown'
  | 'goodAndBadSpells'
  | 'oneOddPeriod'

/** The fewest periods, from the first with a finished ticket, that a pattern is read from. */
const FEWEST_TO_READ = 6

/** Below this many periods read, every pattern but Steady and One odd week is worded as early. */
const FEWEST_TO_BE_SURE = 10

/** How each pattern is worded when read from too few periods to be sure. */
const EARLY: Partial<Record<PacePatternName, string>> = {
  lumpy: 'May be lumpy',
  speedingUp: 'May be speeding up',
  slowingDown: 'May be slowing down',
  steppedUp: 'May have stepped up',
  steppedDown: 'May have stepped down',
  goodAndBadSpells: 'May have good and bad spells',
}

/** The shortest cadence a pattern is read at: shorter periods are mostly quiet, so their counts have no shape. */
const SHORTEST_CADENCE_DAYS = 7

/** Below this two-sided Mann–Kendall p, the counts are taken to be moving one way. */
const TREND_P = 0.05

/** A step fits the moving counts when it leaves less than this share of a straight line's squared error. */
const STEP_FIT = 0.8

/**
 * One period is odd when it stands more than this many spreads above the median, the spread being the square root
 * of the median (at least 1), as a steady pace's counts would vary.
 */
const ODD_SPREADS = 4

/** Above this lag-1 autocorrelation, busy periods follow busy ones and quiet follow quiet. */
const SPELLS_LAG1 = 0.3

/** Above this dispersion (variance over mean), counts vary more than a steady pace would: about 1. */
const LUMPY_DISPERSION = 2

/** The action a pattern offers, with the headline date it would change, both from the same seed. */
export type PatternAction = PaceAction & {
  button: string
  dates: { percent: number; now: string | null; applied: string | null }
}

/** How the view forecasts the headline date: now, and from the counts an action would keep. */
export interface HeadlineDates {
  percent: number
  now: string | null
  from(counts: readonly number[]): string | null
}

/**
 * The pace pattern as the Pace section shows it: one folded line, opened to say what it means and what to do. With
 * no pattern to name, only the faint line saying why.
 */
export interface PacePatternView {
  /** Undefined when there's no pattern to name: the line says why. */
  pattern: PacePatternName | undefined
  /** The folded line: "Steady · 4 to 6 a week". */
  line: string
  /** What the pattern means, with the team's numbers. */
  meaning?: string
  /** What to do, if anything. */
  advice?: string
  /** The action offered; none while one is applied. */
  action?: PatternAction
  /** The action applied, said, with undo beside it: "Counting pace from 12 Oct, after it stepped up." */
  applied?: string
}

/**
 * Seam B, behind `milestoneForecastView`: the pattern in the pace window's counts, at the milestone's cadence, with
 * the action applied to the counts pace is drawn from to make that window, if any.
 */
export function pacePattern(
  { all, window }: { all: DatedCounts; window: DatedCounts },
  applied: PaceAction | undefined,
  cadenceDays: number,
  headline: HeadlineDates,
): PacePatternView {
  if (cadenceDays < SHORTEST_CADENCE_DAYS) return unread('Patterns are read from weeks or sprints.')
  const period = periodName(cadenceDays)
  const read = window.counts.findIndex((count) => count > 0)
  const shown = applied ? { applied: appliedLine(all, applied, period) } : {}
  if (read < 0) return { ...unread(`Nothing finished in these ${window.counts.length} ${period}s: no pattern to read.`), ...shown }
  const counts = window.counts.slice(read)
  if (counts.length < FEWEST_TO_READ) return { ...unread(`No pattern yet · ${counts.length} ${period}s is too few to tell`), ...shown }
  const { action, ...view } = named(counts, window.starts.slice(read), period)
  const early = counts.length < FEWEST_TO_BE_SURE && view.pattern && EARLY[view.pattern]
  const worded = { ...view, ...(early ? { line: `${early}: too early to be sure.` } : {}), ...shown }
  if (!action || applied) return worded
  // offered even when it leaves fewer counts than the forecast needs: applied, the forecast says so
  const { percent, now } = headline
  return { ...worded, action: { ...action, dates: { percent, now, applied: headline.from(withAction(window, action).counts) } } }
}

/**
 * The milestone's applied action, said, as the forecast shows it with undo even when the window it leaves is too short
 * to forecast from; none with none applied.
 */
export function paceActionApplied(inputs: MilestoneInputs, today: string, measured?: Measured): string | undefined {
  const action = inputs.paceWindow.action
  return action && appliedLine(paceWindow(inputs, today, measured).all, action, periodName(inputs.cadenceDays))
}

/** The applied action, said: what the pace is counted from, and why. */
function appliedLine(all: DatedCounts, action: PaceAction, period: PeriodName): string {
  const said = actionSaid(action, period)
  if (action.kind === 'leaveOut') return `${said}, the odd ${period}.`
  const since = withAction(all, action).counts
  const before = all.counts.slice(0, all.counts.length - since.length)
  return `${said}, after it stepped ${mean(since) >= mean(before) ? 'up' : 'down'}.`
}

/** A form on the pace pattern, as typed: apply its action (on `date` or `period`, by its kind), or undo the one applied. */
export type PaceActionEdit = { kind: 'applyPaceAction'; action: string; date?: string; period?: string } | { kind: 'undoPaceAction' }

const PACE_ACTION_EDITS: ReadonlySet<string> = new Set<PaceActionEdit['kind']>(['applyPaceAction', 'undoPaceAction'])

export function isPaceActionEdit(edit: { kind: string }): edit is PaceActionEdit {
  return PACE_ACTION_EDITS.has(edit.kind)
}

/** Seam B, behind `submitInputs`: applies the pace pattern's action to the milestone's pace window, or undoes it. */
export function editPaceAction(storage: Storage, teamId: string, edit: PaceActionEdit): EditResult {
  const saved = storage.milestoneInputs(teamId)
  if (saved === undefined) return refuse('There is no milestone to apply it to.')
  const action = edit.kind === 'undoPaceAction' ? undefined : typedAction(edit)
  if (action === null) return refuse('That action is no longer offered.')
  storage.saveMilestoneInputs({ ...saved, paceWindow: { ...saved.paceWindow, action } })
  return { ok: true }
}

/** The action a form names, or null when it names none. */
function typedAction({ action, date = '', period = '' }: Extract<PaceActionEdit, { kind: 'applyPaceAction' }>): PaceAction | null {
  if (action === 'startFrom' && isCalendarDate(date.trim())) return { kind: 'startFrom', date: date.trim() }
  if (action === 'leaveOut' && isCalendarDate(period.trim())) return { kind: 'leaveOut', period: period.trim() }
  return null
}

/** A pattern as named, its action not yet dated. */
type Named = Omit<PacePatternView, 'action'> & { action?: PaceAction & { button: string } }

/** The pattern in at least `FEWEST_TO_READ` counts, the first of them above 0. */
function named(read: readonly number[], readStarts: readonly string[], period: PeriodName): Named {
  const odd = oddPeriod(read)
  if (odd !== undefined) return oneOdd(read, readStarts, odd, period)
  if (mannKendallP(read) < TREND_P) {
    const { stepError, lineError, at, slope } = stepVersusLine(read)
    return stepError < STEP_FIT * lineError ? stepped(read, readStarts, at, period) : trending(read, slope > 0, period)
  }
  if (lag1(read) > SPELLS_LAG1) {
    return {
      pattern: 'goodAndBadSpells',
      line: `Good and bad spells · ${spread(read, period)}`,
      meaning: `Busy ${period}s come together and so do quiet ones: ${spread(read, period)}, in runs.`,
      advice: `The range may be too narrow, since quiet ${period}s come in runs. Hold the dates loosely.`,
    }
  }
  if (dispersion(read) > LUMPY_DISPERSION) {
    return {
      pattern: 'lumpy',
      line: `Lumpy · ${spread(read, period)}`,
      meaning: `Work finishes in batches, ${spread(read, period)}, so the range is wide because the pace really varies.`,
      advice:
        `Keep every ${period}, zeros included, and accept the wide range. To narrow it, split work smaller, ` +
        "finish before starting, and close tickets as soon as they're done.",
    }
  }
  return {
    pattern: 'steady',
    line: `Steady · ${spread(read, period)}`,
    meaning: `No sign the pace is changing. The forecast takes these ${period}s as they are.`,
  }
}

function unread(line: string): PacePatternView {
  return { pattern: undefined, line }
}

/** The index of the highest count if it stands far above the rest and the rest are no lumpier than a steady pace. */
function oddPeriod(counts: readonly number[]): number | undefined {
  const middle = median(counts)
  const highest = counts.indexOf(Math.max(...counts))
  const rest = counts.filter((_, i) => i !== highest)
  const standsOut = (counts[highest]! - middle) / Math.max(1, Math.sqrt(middle)) > ODD_SPREADS
  return standsOut && dispersion(rest) < LUMPY_DISPERSION ? highest : undefined
}

/** One odd period, named, offering to leave it out. */
function oneOdd(counts: readonly number[], starts: readonly string[], odd: number, period: PeriodName): Named {
  const date = starts[odd]!
  const rest = counts.filter((_, i) => i !== odd)
  return {
    pattern: 'oneOddPeriod',
    line: `One odd ${period} · ${dayMonth(date)} finished ${counts[odd]}`,
    meaning:
      `The ${period} of ${dayMonth(date)} finished ${counts[odd]}, ` +
      `against ${Math.min(...rest)} to ${Math.max(...rest)} in the other ${period}s.`,
    advice: `If that ${period} wasn't like the others, leave it out of the pace.`,
    action: { kind: 'leaveOut', period: date, button: `Leave out ${dayMonth(date)}` },
  }
}

/** Stepped up or down at period `at`, offering to count pace from there. */
function stepped(counts: readonly number[], starts: readonly string[], at: number, period: PeriodName): Named {
  const before = Math.round(mean(counts.slice(0, at)))
  const after = Math.round(mean(counts.slice(at)))
  const date = starts[at]!
  const since = `about ${before} a ${period}, then ${after} since ${dayMonth(date)}`
  return {
    pattern: after > before ? 'steppedUp' : 'steppedDown',
    line: `${after > before ? 'Stepped up' : 'Stepped down'} · ${since}`,
    meaning: `${since[0]!.toUpperCase()}${since.slice(1)}.`,
    advice: `If that's lasting, count pace from ${dayMonth(date)}.`,
    action: { kind: 'startFrom', date, button: `Start from ${dayMonth(date)}` },
  }
}

/** Speeding up or slowing down: the first half's level against the last's, advising not to extend the trend. */
function trending(counts: readonly number[], up: boolean, period: PeriodName): Named {
  const half = Math.floor(counts.length / 2)
  const first = Math.round(mean(counts.slice(0, half)))
  const last = Math.round(mean(counts.slice(half)))
  return {
    pattern: up ? 'speedingUp' : 'slowingDown',
    line: `${up ? 'Speeding up' : 'Slowing down'} · from about ${first} to about ${last} a ${period}`,
    meaning: `From about ${first} a ${period} in the first ${half} ${period}s to about ${last} in the last ${counts.length - half}.`,
    advice:
      `Don't extend the trend: the forecast draws from all ${counts.length} ${period}s, so if it goes on, ` +
      `the dates will move ${up ? 'sooner' : 'later'} as new ${period}s are read.`,
  }
}

/** "4 to 6 a week": the lowest and highest count. */
function spread(counts: readonly number[], period: PeriodName): string {
  return `${Math.min(...counts)} to ${Math.max(...counts)} a ${period}`
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function mean(values: readonly number[]): number {
  return sum(values) / values.length
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const half = sorted.length >> 1
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2
}

/** Variance (n − 1) over mean: about 1 for a steady pace, more when counts come in batches. */
function dispersion(counts: readonly number[]): number {
  return squaredError(counts) / (counts.length - 1) / Math.max(1e-9, mean(counts))
}

/** How much each count follows the one before: near 0 for a steady pace, high when counts run in spells. */
function lag1(counts: readonly number[]): number {
  const m = mean(counts)
  let together = 0
  counts.forEach((count, i) => {
    if (i > 0) together += (count - m) * (counts[i - 1]! - m)
  })
  const spread = squaredError(counts)
  return spread === 0 ? 0 : together / spread
}

/** Two-sided p that the counts have no trend: Mann–Kendall, normal approximation with tie correction. */
function mannKendallP(counts: readonly number[]): number {
  const n = counts.length
  let s = 0
  for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(counts[j]! - counts[i]!)
  const ties = new Map<number, number>()
  for (const count of counts) ties.set(count, (ties.get(count) ?? 0) + 1)
  let tieTerm = 0
  for (const t of ties.values()) tieTerm += t * (t - 1) * (2 * t + 5)
  const variance = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18
  if (variance <= 0) return 1
  const z = s === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance)
  return 2 * (1 - normalCdf(Math.abs(z)))
}

/** The standard normal CDF, by Abramowitz and Stegun 7.1.26. */
function normalCdf(z: number): number {
  const t = 1 / (1 + (0.3275911 * z) / Math.SQRT2)
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return 0.5 * (1 + (1 - poly * Math.exp((-z * z) / 2)))
}

/**
 * The squared error of the best two-level split (each side keeping at least 2 periods), with the index of the first
 * period after it, against that of the least-squares line, with its slope.
 */
function stepVersusLine(counts: readonly number[]): { stepError: number; lineError: number; at: number; slope: number } {
  const n = counts.length
  const meanIndex = (n - 1) / 2
  const meanCount = mean(counts)
  let sxy = 0
  let sxx = 0
  counts.forEach((count, i) => {
    sxy += (i - meanIndex) * (count - meanCount)
    sxx += (i - meanIndex) ** 2
  })
  const slope = sxy / sxx
  const lineError = sum(counts.map((count, i) => (count - (meanCount + slope * (i - meanIndex))) ** 2))
  let stepError = Infinity
  let at = 0
  for (let k = 2; k <= n - 2; k++) {
    const error = squaredError(counts.slice(0, k)) + squaredError(counts.slice(k))
    if (error < stepError) {
      stepError = error
      at = k
    }
  }
  return { stepError, lineError, at, slope }
}

function squaredError(values: readonly number[]): number {
  const m = mean(values)
  return sum(values.map((value) => (value - m) ** 2))
}
