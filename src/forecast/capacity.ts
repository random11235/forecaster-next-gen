import type { CapacityEntry } from '../model/capacity.js'
import type { Storage } from '../storage/storage.js'
import type { PeriodName } from './cadence.js'
import { daysBetween, isCalendarDate } from './calendarDate.js'
import { counted } from './counted.js'
import { refuse, type EditResult } from './editResult.js'

/** Far above any real team's growth, as the engine's own limit: keeps typos like 5000% out of the forecast. */
export const MAX_CAPACITY_PERCENT = 1000

/** Above this, the pace comes from a team much smaller than the one forecast, so the entry is warned of. */
export const WARN_ABOVE_PERCENT = 150

/** A capacity form the EM submits beside the forecast, as typed. */
export type CapacityEdit =
  /** "The team is at {percent}% from {from} to {to}, or onward, for {note}." An empty `to` is the one day `from`. */
  | { kind: 'addCapacity'; percent: string; from: string; to: string; onward: boolean; note: string }
  | { kind: 'removeCapacity'; id: string }
  /** "Use capacity in this forecast": off keeps the entries, which still count for the next milestone. */
  | { kind: 'switchCapacity'; on: boolean }

/** The capacity form's sentence, as saved (blank) or as typed when refused. */
export interface CapacityForm {
  percent: string
  from: string
  to: string
  onward: boolean
  note: string
}

/** An entry as the capacity section lists it, with the warning beside it, if any. */
export interface CapacityEntryView extends CapacityEntry {
  warning?: string
}

/**
 * What capacity does to this forecast: nothing, as no entry touches its periods; switched off, its entries kept; or in
 * use, moving the 85% date by `shift` periods (later when positive), null when either date is later than the horizon.
 */
export type CapacityUse = { kind: 'unused' } | { kind: 'off' } | { kind: 'inUse'; shift: number | null }

/** What the Milestone forecast screen's Capacity section shows. */
export interface CapacityView {
  /** Whether the forecast uses capacity; on until the EM switches it off. */
  on: boolean
  /** The folded section's line: "none, every week usual", or "2 entries · 85% date 2 weeks later". */
  summary: string
  /** The team's entries, earliest first. */
  entries: CapacityEntryView[]
  form: CapacityForm
  /** Why the capacity form just submitted was refused; none until one is. */
  refusal?: string
}

export const BLANK_CAPACITY_FORM: CapacityForm = { percent: '', from: '', to: '', onward: false, note: '' }

/** Seam B, behind `milestoneForecastView`: the team's capacity as the section shows it, its form blank. */
export function capacityView(storage: Storage, teamId: string, use: CapacityUse, period: PeriodName): CapacityView {
  const entries = sorted(storage.capacityEntries(teamId)).map((entry) => {
    const warning = bigTeamWarning(entry.percent)
    return warning === undefined ? entry : { ...entry, warning }
  })
  return { on: storage.capacityOn(teamId), summary: capacitySummary(entries.length, use, period), entries, form: BLANK_CAPACITY_FORM }
}

function capacitySummary(entries: number, use: CapacityUse, period: PeriodName): string {
  if (entries === 0) return `none, every ${period} usual`
  const listed = counted(entries, 'entry', 'entries')
  if (use.kind === 'off') return `off · ${listed}`
  return use.kind === 'inUse' && use.shift ? `${listed} · 85% date ${shifted(use.shift, period)}` : listed
}

/**
 * The quiet line under the headline, saying the headline date includes capacity and what that does to it; none when
 * no capacity touches the forecast.
 */
export function capacityLine(use: CapacityUse, period: PeriodName): string | undefined {
  switch (use.kind) {
    case 'unused':
      return undefined
    case 'off':
      return 'Capacity is switched off for this forecast; its entries are kept.'
    case 'inUse':
      if (use.shift === null) return 'Includes capacity.'
      return use.shift === 0 ? 'Includes capacity, which doesn’t move the 85% date.' : `Includes capacity, which moves the 85% date ${shifted(use.shift, period)}.`
  }
}

/** A shift in periods as words: "2 weeks later", "1 sprint sooner", "same week". */
export function shifted(shift: number, period: PeriodName): string {
  return shift === 0 ? `same ${period}` : `${counted(Math.abs(shift), period)} ${shift > 0 ? 'later' : 'sooner'}`
}

/** An entry far above usual: the pace was measured on a team a fraction of that size. */
function bigTeamWarning(percent: number): string | undefined {
  if (percent <= WARN_ABOVE_PERCENT) return undefined
  const share = Math.round((100 / percent) * 100)
  return `At ${percent}%, the pace comes from a team about ${share}% this size, so it’s a weak guide. A pace range may be better.`
}

/** Seam B, through `submitInputs`: adds or removes a capacity entry, or switches capacity. A refused edit changes nothing and says why. */
export function editCapacity(storage: Storage, teamId: string, edit: CapacityEdit): EditResult {
  if (edit.kind === 'switchCapacity') {
    storage.saveCapacityOn(teamId, edit.on)
    return { ok: true }
  }
  const entries = storage.capacityEntries(teamId)
  if (edit.kind === 'removeCapacity') {
    storage.saveCapacityEntries(teamId, entries.filter(({ id }) => String(id) !== edit.id.trim()))
    return { ok: true }
  }
  const from = edit.from.trim()
  const to = edit.onward ? undefined : edit.to.trim() || from
  if (!isCalendarDate(from)) return refuse('Pick the date it starts.')
  if (to !== undefined && !isCalendarDate(to)) return refuse('Pick the date it ends, or choose onward.')
  if (to !== undefined && daysBetween(from, to) < 0) return refuse('The end date is before the start.')
  const percent = edit.percent.trim()
  if (!/^\d+$/.test(percent)) return refuse('Capacity is a whole percentage, 0 or more.')
  const added: CapacityEntry = { id: nextId(entries), from, to, percent: Number(percent), note: edit.note.trim() }
  if (added.percent > MAX_CAPACITY_PERCENT) return refuse(ABOVE_MAX)
  if (highestOverlap([...entries, added]) > MAX_CAPACITY_PERCENT / 100) return refuse(`${ABOVE_MAX} Here it overlaps other entries, which multiply.`)
  storage.saveCapacityEntries(teamId, [...entries, added])
  return { ok: true }
}

const ABOVE_MAX = `Capacity above ${MAX_CAPACITY_PERCENT}% can’t be forecast. For a team that much bigger, use a pace range.`

function nextId(entries: readonly CapacityEntry[]): number {
  return Math.max(0, ...entries.map(({ id }) => id)) + 1
}

/**
 * The most any day's capacity could reach, as a factor: overlapping entries multiply. The highest product of the entries
 * above usual is reached on the day the last of them starts, so checking each start date is enough.
 */
function highestOverlap(entries: readonly CapacityEntry[]): number {
  const above = entries.filter(({ percent }) => percent > 100)
  return Math.max(1, ...above.map(({ from }) => dayFactor(from, above)))
}

/**
 * Each period's capacity factor from the start date, for the engine: the average, over the period's working days
 * (Monday to Friday), of each day's capacity. A day no entry covers is at 100%, and entries covering the same day
 * multiply. Trailing usual periods are left off, so with nothing to change the forecast gets no factors at all.
 */
export function capacityFactors(entries: readonly CapacityEntry[], startDate: string, periodDays: number, periods: number): number[] | undefined {
  if (entries.length === 0) return undefined
  const factors: number[] = []
  for (let period = 0; period < periods; period++) {
    const workingDays = Array.from({ length: periodDays }, (_, day) => addDays(startDate, period * periodDays + day)).filter(isWorkingDay)
    const total = workingDays.reduce((sum, day) => sum + dayFactor(day, entries), 0)
    // a period with no working day (a 1-day cadence on a weekend) has nothing to scale
    factors.push(workingDays.length === 0 ? 1 : total / workingDays.length)
  }
  while (factors.length > 0 && factors.at(-1) === 1) factors.pop()
  return factors.length === 0 ? undefined : factors
}

/** One day's capacity as a factor: the product of every entry covering it, 1 when none does. */
function dayFactor(day: string, entries: readonly CapacityEntry[]): number {
  // ISO calendar dates order as strings do
  return entries.filter(({ from, to }) => from <= day && (to === undefined || day <= to)).reduce((factor, { percent }) => (factor * percent) / 100, 1)
}

function sorted(entries: readonly CapacityEntry[]): CapacityEntry[] {
  return [...entries].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.id - b.id))
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

function isWorkingDay(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday !== 0 && weekday !== 6
}
