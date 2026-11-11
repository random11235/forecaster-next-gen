import type { CapacityEntry } from '../model/capacity.js'
import type { Storage } from '../storage/storage.js'
import type { PeriodName } from './cadence.js'
import { addDays, daysBetween, isCalendarDate } from './calendarDate.js'
import { counted } from './counted.js'
import { refuse, type EditResult, type Refusal } from './editResult.js'
import type { ComparedDate } from './milestoneForecastView.js'

/** Far above any real team's growth, as the engine's own limit: keeps typos like 5000% out of the forecast. */
export const MAX_CAPACITY_PERCENT = 1000

/** Above this, the pace comes from a team much smaller than the one forecast, so the entry is warned of. */
export const WARN_ABOVE_PERCENT = 150

/** A capacity form the EM submits beside the forecast, as typed. */
export type CapacityEdit =
  /** "The team is at {percent}% from {from} to {to}, or onward, for {note}." An empty `to` is the one day `from`. */
  | { kind: 'addCapacity'; percent: string; from: string; to: string; onward: boolean; note: string }
  | { kind: 'removeCapacity'; id: string }
  /** Save on entry `id`'s edit form, the same sentence as typed. A past entry keeps all but its note. */
  | ({ kind: 'editCapacity'; id: string } & CapacityForm)
  /** "Use capacity in this forecast": off keeps the entries, which still count for the next milestone. */
  | { kind: 'switchCapacity'; on: boolean }
  /** "Make it the new usual": ends entry `id` today, so the pace that already shows it doesn't count it twice. */
  | { kind: 'acceptNewUsual'; id: string }
  /** "Keep it": entry `id` is no longer proposed as the new usual. */
  | { kind: 'keepCapacity'; id: string }
  /** "End it today", with a pace range: entry `id` ends yesterday. */
  | { kind: 'endCapacityToday'; id: string }

const CAPACITY_EDITS: ReadonlySet<string> = new Set<CapacityEdit['kind']>([
  'addCapacity',
  'removeCapacity',
  'editCapacity',
  'switchCapacity',
  'acceptNewUsual',
  'keepCapacity',
  'endCapacityToday',
])

/** Whether a submitted form is one of the capacity forms beside the forecast. */
export function isCapacityEdit(edit: { kind: string }): edit is CapacityEdit {
  return CAPACITY_EDITS.has(edit.kind)
}

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
  /** What this entry alone does to the 85% date; given only with the section open and capacity in use. */
  effect?: EntryEffect
  /** For a lasting entry that has started: how far the pace has caught up with it; none when it has an end. */
  newUsual?: NewUsual
}

/**
 * A lasting entry against the pace. With typed counts: `after` of the `of` periods the pace comes from start on or after
 * it, or, once all of them do, proposed as the new usual (until kept). With a pace range: "End it today".
 */
export type NewUsual = { kind: 'counting'; after: number; of: number } | { kind: 'proposed' } | { kind: 'endToday' }

/** The periods the pace comes from, for the new-usual rule: a range has none; typed counts, each period's first day. */
export type PacePeriods = { source: 'range' } | { source: 'counts'; starts: string[] }

/**
 * An entry's own effect on the 85% date: the shift, in periods (later when positive), between the forecast with
 * capacity and a run without that entry, from the same draws; null when only one of the two dates is within the horizon.
 */
export interface EntryEffect {
  shift: number | null
  /** "85% date +1 wk", "85% date −2 sprints", "no change to the 85% date". */
  words: string
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
  /** Whether the section is shown open: the EM opened it, or a capacity form just submitted from it was refused. */
  open: boolean
  /** The folded section's line: "none, every week usual", or "2 entries · 85% date 2 weeks later". */
  summary: string
  /** The team's entries the forecast uses, earliest first. */
  entries: CapacityEntryView[]
  /** Entries that have ended: kept, not used by the forecast; only their note can change. Earliest first. */
  past: CapacityEntry[]
  form: CapacityForm
  /** Why the capacity form just submitted was refused; none until one is. */
  refusal?: string
  /** An entry's edit just refused: its form as typed, and why. */
  editing?: { id: number; form: CapacityForm; refusal: string }
}

export const BLANK_CAPACITY_FORM: CapacityForm = { percent: '', from: '', to: '', onward: false, note: '' }

/**
 * Seam B, behind `milestoneForecastView`: the team's capacity on `today` as the section shows it, its form blank. With
 * `effects` (by entry id), each entry the forecast uses gives its own effect; against `pace`, each lasting one its new-usual line.
 */
export function capacityView(
  storage: Storage,
  teamId: string,
  today: string,
  use: CapacityUse,
  period: PeriodName,
  { open, effects, pace }: { open: boolean; effects?: ReadonlyMap<number, EntryEffect>; pace: PacePeriods },
): CapacityView {
  const all = sorted(storage.capacityEntries(teamId))
  const entries = currentEntries(all, today).map((entry) => {
    const warning = bigTeamWarning(entry.percent)
    const effect = effects?.get(entry.id)
    const newUsual = newUsualOf(entry, pace, today)
    return { ...entry, ...(warning !== undefined && { warning }), ...(effect && { effect }), ...(newUsual && { newUsual }) }
  })
  const past = all.filter((entry) => isPast(entry, today))
  return { on: storage.capacityOn(teamId), open, summary: capacitySummary(entries.length, use, period), entries, past, form: BLANK_CAPACITY_FORM }
}

/**
 * An entry's effect, from the 85% date compared with capacity and `atUsual` without the entry: a null date is later
 * than the horizon.
 */
export function entryEffect({ withCapacity, atUsual: without, shift }: ComparedDate, period: PeriodName): EntryEffect {
  if (withCapacity === without) return { shift: 0, words: 'no change to the 85% date' }
  if (shift === null) return { shift, words: withCapacity === null ? '85% date later than the horizon' : '85% date within the horizon, not past it' }
  const unit = period === 'week' ? 'wk' : Math.abs(shift) === 1 ? 'sprint' : 'sprints'
  return { shift, words: `85% date ${shift > 0 ? '+' : '−'}${Math.abs(shift)} ${unit}` }
}

/** A lasting entry that has started, against the periods the pace comes from; none for any other entry. */
function newUsualOf(entry: CapacityEntry, pace: PacePeriods, today: string): NewUsual | undefined {
  // ISO calendar dates order as strings do
  if (entry.to !== undefined || entry.from > today) return undefined
  if (pace.source === 'range') return entry.from < today ? { kind: 'endToday' } : undefined
  const after = pace.starts.filter((start) => start >= entry.from).length
  if (after < pace.starts.length) return { kind: 'counting', after, of: pace.starts.length }
  return entry.kept ? undefined : { kind: 'proposed' }
}

/** The team's entries the forecast uses on `today`: those not past. */
export function currentEntries(entries: readonly CapacityEntry[], today: string): CapacityEntry[] {
  return entries.filter((entry) => !isPast(entry, today))
}

/**
 * An entry is past once its end is before today, or once accepted as the new usual: kept, never deleted, but no
 * longer used by the forecast.
 */
function isPast({ to, newUsualOn }: CapacityEntry, today: string): boolean {
  // ISO calendar dates order as strings do
  return newUsualOn !== undefined || (to !== undefined && to < today)
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

/**
 * Seam B, through `submitInputs`: adds, edits or removes a capacity entry on `today`, or switches capacity; accepts an
 * entry as the new usual, keeps it, or ends it today. An edit is checked as an add is, but a past entry's edit changes
 * only its note. A refused edit changes nothing and says why.
 */
export function editCapacity(storage: Storage, teamId: string, today: string, edit: CapacityEdit): EditResult {
  if (edit.kind === 'switchCapacity') {
    storage.saveCapacityOn(teamId, edit.on)
    return { ok: true }
  }
  const entries = storage.capacityEntries(teamId)
  if (edit.kind === 'removeCapacity') {
    if (entries.some((entry) => String(entry.id) === edit.id.trim() && isPast(entry, today))) return refuse('Past entries are kept, so it can’t be removed.')
    storage.saveCapacityEntries(teamId, entries.filter(({ id }) => String(id) !== edit.id.trim()))
    return { ok: true }
  }
  if (edit.kind === 'addCapacity') {
    const added = typedEntry(edit, nextId(entries), currentEntries(entries, today))
    if (!added.ok) return added
    storage.saveCapacityEntries(teamId, [...entries, added.entry])
    return { ok: true }
  }
  const edited = entries.find(({ id }) => String(id) === edit.id.trim())
  if (edited === undefined) return refuse('That entry is no longer there.')
  const save = (entry: CapacityEntry): EditResult => {
    storage.saveCapacityEntries(teamId, entries.map((other) => (other === edited ? entry : other)))
    return { ok: true }
  }
  if (edit.kind === 'acceptNewUsual' || edit.kind === 'keepCapacity' || edit.kind === 'endCapacityToday') {
    if (isPast(edited, today)) return refuse('That entry has already ended.')
    // ISO calendar dates order as strings do
    if (edited.from >= today && edit.kind !== 'keepCapacity') return refuse('It hasn’t started yet, so there’s nothing to end: remove it instead.')
    if (edit.kind === 'keepCapacity') return save({ ...edited, kept: true })
    return save(edit.kind === 'acceptNewUsual' ? { ...edited, to: today, newUsualOn: today } : { ...edited, to: addDays(today, -1) })
  }
  // past entries no longer count, so they don't count toward the limit on overlaps either
  const others = currentEntries(entries, today).filter((entry) => entry !== edited)
  const saved = isPast(edited, today) ? { ok: true as const, entry: { ...edited, note: edit.note.trim() } } : typedEntry(edit, edited.id, others)
  return saved.ok ? save(saved.entry) : saved
}

/** The entry a capacity sentence types, numbered `id`, or why it is refused beside the team's `others`. */
function typedEntry(typed: CapacityForm, id: number, others: readonly CapacityEntry[]): { ok: true; entry: CapacityEntry } | Refusal {
  const from = typed.from.trim()
  const to = typed.onward ? undefined : typed.to.trim() || from
  if (!isCalendarDate(from)) return refuse('Pick the date it starts.')
  if (to !== undefined && !isCalendarDate(to)) return refuse('Pick the date it ends, or choose onward.')
  if (to !== undefined && daysBetween(from, to) < 0) return refuse('The end date is before the start.')
  const percent = typed.percent.trim()
  if (!/^\d+$/.test(percent)) return refuse('Capacity is a whole percentage, 0 or more.')
  const entry: CapacityEntry = { id, from, to, percent: Number(percent), note: typed.note.trim() }
  if (entry.percent > MAX_CAPACITY_PERCENT) return refuse(ABOVE_MAX)
  if (highestOverlap([...others, entry]) > MAX_CAPACITY_PERCENT / 100) return refuse(`${ABOVE_MAX} Here it overlaps other entries, which multiply.`)
  return { ok: true, entry }
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

function isWorkingDay(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return weekday !== 0 && weekday !== 6
}
