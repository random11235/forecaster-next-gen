import { periodName, type PeriodName } from '../forecast/cadence.js'
import {
  MAX_CADENCE_DAYS,
  MAX_TICKETS_PER_WEEK,
  MAX_TICKETS_REMAINING,
  type MilestoneInput,
  type InputNote,
  type MilestoneInputsView,
} from '../forecast/milestoneInputs.js'
import { ambiguityName, MAX_GROWTH, type GrowthView, type TypedRange } from '../forecast/growth.js'
import { TYPED_COUNTS } from '../forecast/settings.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import type { PaceMode } from '../model/milestoneInputs.js'
import { escapeHtml, htmlPage } from './html.js'

/** Each input of the milestone by its label on this screen, which notes about it are named by everywhere. */
export const INPUT_LABELS: Record<MilestoneInput, string> = {
  name: 'Name',
  startDate: 'Start date',
  ticketsRemaining: 'Tickets remaining',
  pace: 'Pace',
}

/** The pace form as typed: what the EM entered, and why it was refused, if it was. */
export interface PaceForm {
  low: string
  high: string
  error?: string
}

/** Reads the submitted pace form; the rules it must meet are checked when it is saved. */
export function parsePaceForm(body: URLSearchParams): PaceForm {
  return { low: body.get('low')?.trim() ?? '', high: body.get('high')?.trim() ?? '' }
}

/** The pace form filled with the saved range, or empty. */
export function savedPaceForm(view: MilestoneInputsView): PaceForm {
  return view.paceRange ? { low: String(view.paceRange.low), high: String(view.paceRange.high) } : { low: '', high: '' }
}

/** The typed counts forms as typed: the list, the count to add, and why either was refused, if it was. */
export interface PaceCountsForm {
  /** The list, oldest first, apart by commas. */
  counts: string
  /** The newest count, to add after the rest. */
  count: string
  error?: string
}

/** Reads the submitted typed counts list; the rules it must meet are checked when it is saved. */
export function parsePaceCountsForm(body: URLSearchParams): string {
  return body.get('counts')?.trim() ?? ''
}

/** Reads the submitted count to add; the rules it must meet are checked when it is saved. */
export function parseAddCountForm(body: URLSearchParams): string {
  return body.get('count')?.trim() ?? ''
}

/** The typed counts forms filled with the saved counts, oldest first, and nothing to add. */
export function savedPaceCountsForm(view: MilestoneInputsView): PaceCountsForm {
  return { counts: view.paceCounts.join(', '), count: '' }
}

/** The pace choice form: the choice is saved or shown as saved, so only why it was refused, if it was. */
export interface PaceModeForm {
  error?: string
}

/** Reads the submitted pace choice; whether it is one is checked when it is saved. */
export function parsePaceModeForm(body: URLSearchParams): string {
  return body.get('paceMode') ?? ''
}

/** The cadence form as typed, and why it was refused, if it was. */
export interface CadenceForm {
  cadenceDays: string
  error?: string
}

/** Reads the submitted cadence form; the rules it must meet are checked when it is saved. */
export function parseCadenceForm(body: URLSearchParams): CadenceForm {
  return { cadenceDays: body.get('cadenceDays')?.trim() ?? '' }
}

/** The cadence form filled with the saved cadence, 7 days until the EM sets one. */
export function savedCadenceForm(view: MilestoneInputsView): CadenceForm {
  return { cadenceDays: String(view.cadenceDays) }
}

/** The ambiguity ranges form as typed: each level's low and high, and why they were refused, if they were. */
export interface GrowthForm {
  ranges: Record<Ambiguity, TypedRange>
  error?: string
}

/** Reads the submitted ambiguity ranges; the rules they must meet are checked when they are saved. */
export function parseGrowthForm(body: URLSearchParams): GrowthForm {
  const typed = (level: Ambiguity): TypedRange => ({ low: body.get(`${level}-low`) ?? '', high: body.get(`${level}-high`) ?? '' })
  return { ranges: { low: typed('low'), medium: typed('medium'), high: typed('high') } }
}

/** The ambiguity ranges form filled with the team's saved ranges. */
export function savedGrowthForm({ ranges }: GrowthView): GrowthForm {
  const typed = ({ low, high }: { low: number; high: number }): TypedRange => ({ low: String(low), high: String(high) })
  return { ranges: { low: typed(ranges.low), medium: typed(ranges.medium), high: typed(ranges.high) } }
}

/** The ambiguity form: the level is saved or shown as saved, so only why a level was refused, if it was. */
export interface AmbiguityForm {
  error?: string
}

/** Reads the submitted ambiguity level; whether it is one is checked when it is saved. */
export function parseAmbiguityForm(body: URLSearchParams): string {
  return body.get('ambiguity') ?? ''
}

/** The milestone form as typed, and why it was refused, if it was. */
export interface MilestoneForm {
  name: string
  startDate: string
  ticketsRemaining: string
  error?: string
}

/** Reads the submitted milestone form; the rules it must meet are checked when it is saved. */
export function parseMilestoneForm(body: URLSearchParams): MilestoneForm {
  return {
    name: body.get('name') ?? '',
    startDate: body.get('startDate')?.trim() ?? '',
    ticketsRemaining: body.get('ticketsRemaining')?.trim() ?? '',
  }
}

/** The milestone form filled with what is saved, the start date pre-filled with today until one is. */
export function savedMilestoneForm(view: MilestoneInputsView): MilestoneForm {
  return { name: view.name, startDate: view.startDate, ticketsRemaining: view.ticketsRemaining === undefined ? '' : String(view.ticketsRemaining) }
}

/** What the Inputs screen shows. */
export interface InputsScreen {
  milestone: MilestoneInputsView
  /** The milestone form, as saved or as typed when refused. */
  milestoneForm: MilestoneForm
  /** The cadence form, as saved or as typed when refused. */
  cadenceForm: CadenceForm
  /** The pace form, as saved or as typed when refused. */
  paceForm: PaceForm
  /** Which pace the forecast uses, with why a choice was refused, if it was. */
  paceModeForm: PaceModeForm
  /** The typed counts forms, as saved or as typed when refused. */
  paceCountsForm: PaceCountsForm
  /** The milestone's ambiguity level, with why a level was refused, if it was. */
  ambiguityForm: AmbiguityForm
  /** The ambiguity ranges form, as saved or as typed when refused. */
  growth: GrowthForm
  /** The team's saved ambiguity ranges, shown beside each level. */
  ranges: GrowthView['ranges']
}

/** The Inputs screen: the milestone, its pace and the team's growth. */
export function renderInputsScreen(screen: InputsScreen): string {
  const { milestone } = screen
  const sections = [
    milestoneSection(screen.milestoneForm, milestone.notes),
    cadenceSection(screen.cadenceForm),
    paceSection(screen, periodName(milestone.cadenceDays)),
    ambiguitySection(milestone.ambiguity, screen.ranges, screen.ambiguityForm),
    growthSection(screen.growth),
  ]
  const header = {
    context: milestone.name === '' ? undefined : escapeHtml(milestone.name),
    heading: 'Inputs',
    lede: 'What drives the forecast: the milestone, the team’s pace, and how work grows.',
  }
  return htmlPage('Inputs', '/inputs', header, sections.map((section, index) => section(index + 1)).join('\n'))
}

/** A section of the Inputs screen, given its number on the screen. */
type Section = (number: number) => string

/** A numbered section: its name and hint in the label column, `body` beside them. */
function inputSection(label: string, name: string, hint: string, body: string): Section {
  return (number) => `    <section class="input" aria-label="${label}">
      <div class="label">
        <span class="number">${String(number).padStart(2, '0')}</span>
        <h2>${name}</h2>
        <p>${hint}</p>
      </div>
      <div class="body">
${body}
      </div>
    </section>`
}

function milestoneSection(form: MilestoneForm, notes: readonly InputNote[]): Section {
  return inputSection(
    'Milestone',
    'Milestone',
    'Name the milestone, the date work on it starts, and how many tickets are left.',
    `        <form method="post" action="/inputs/milestone">${errorLine(form.error)}
          <div class="fields">
            <label class="wide">${INPUT_LABELS.name} <input type="text" name="name" value="${escapeHtml(form.name)}" required></label>${notesFor('name', notes)}
            <label>${INPUT_LABELS.startDate} <input type="date" name="startDate" value="${escapeHtml(form.startDate)}" required></label>${notesFor('startDate', notes)}
            <label>${INPUT_LABELS.ticketsRemaining} <input type="number" name="ticketsRemaining" min="0" max="${MAX_TICKETS_REMAINING}" step="1" value="${escapeHtml(form.ticketsRemaining)}" required></label>${notesFor('ticketsRemaining', notes)}
          </div>
          <div class="actions"><button type="submit" class="primary">Save milestone</button></div>
        </form>`,
  )
}

/** The notes about one input, shown beside it. */
function notesFor(input: MilestoneInput, notes: readonly InputNote[]): string {
  return notes
    .filter((note) => note.input === input)
    .map((note) => `\n            <p class="warning">⚠ ${escapeHtml(note.message)}</p>`)
    .join('')
}

function errorLine(error: string | undefined): string {
  return error ? `\n          <p class="error" role="alert">${escapeHtml(error)}</p>` : ''
}

function cadenceSection(form: CadenceForm): Section {
  return inputSection(
    'Cadence',
    'Cadence',
    'How many days the team’s sprint lasts. Pace is entered per sprint, and 7 days counts as a week.',
    `        <form method="post" action="/inputs/cadence">${errorLine(form.error)}
          <div class="pace">
            <label>Cadence length <input type="number" name="cadenceDays" min="1" max="${MAX_CADENCE_DAYS}" step="1" value="${escapeHtml(form.cadenceDays)}" required></label>
            <span class="unit">days</span>
          </div>
          <div class="actions"><button type="submit">Save cadence</button></div>
        </form>`,
  )
}

const PACE_MODE_NAMES: Record<PaceMode, string> = { range: 'Range', counts: 'Typed counts' }

/** The pace: which one the forecast uses, the range, and the typed counts, the notes beside the one in use. */
function paceSection(screen: InputsScreen, period: PeriodName): Section {
  const { paceMode, notes } = screen.milestone
  const notesIfUsed = (mode: PaceMode): string => (mode === paceMode ? notesFor('pace', notes) : '')
  const modes = (['range', 'counts'] as const)
    .map(
      (mode) =>
        `            <label><input type="radio" name="paceMode" value="${mode}"${mode === paceMode ? ' checked' : ''} required> ${PACE_MODE_NAMES[mode]}</label>`,
    )
    .join('\n')
  const { paceForm: range, paceCountsForm: counts } = screen
  return inputSection(
    INPUT_LABELS.pace,
    INPUT_LABELS.pace,
    `How many tickets the team finishes in a ${period}: a range from a slow ${period} to a good one, or typed counts of past ${period}s. Typed counts need at least ${TYPED_COUNTS.forForecast} for a forecast, and ${TYPED_COUNTS.reliable} to be reliable.`,
    `        <form method="post" action="/inputs/pace-mode">${errorLine(screen.paceModeForm.error)}
          <fieldset class="levels" aria-label="Pace the forecast uses">
${modes}
          </fieldset>
          <div class="actions"><button type="submit" class="primary">Use this pace</button></div>
        </form>
        <form method="post" action="/inputs/pace">${errorLine(range.error)}
          <h3>${PACE_MODE_NAMES.range}</h3>
          <div class="pace">
            <label>Low <input type="number" name="low" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(range.low)}" required></label>
            <span class="to">to</span>
            <label>High <input type="number" name="high" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(range.high)}" required></label>
            <span class="unit">tickets per ${period}</span>
          </div>${notesIfUsed('range')}
          <div class="actions"><button type="submit" class="primary">Save and forecast</button></div>
        </form>
        <form method="post" action="/inputs/pace-counts">${errorLine(counts.error)}
          <h3>${PACE_MODE_NAMES.counts}</h3>
          <div class="fields">
            <label class="wide">Tickets done each ${period}, oldest first <input type="text" name="counts" value="${escapeHtml(counts.counts)}" inputmode="numeric" placeholder="6, 4, 9"></label>
          </div>${notesIfUsed('counts')}
          <div class="actions"><button type="submit">Save counts</button></div>
        </form>
        <div class="counts">
          <form method="post" action="/inputs/pace-counts/add">
            <div class="fields">
              <label>Newest ${period} <input type="number" name="count" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(counts.count)}" required></label>
              <button type="submit">Add count</button>
            </div>
          </form>
          <form method="post" action="/inputs/pace-counts/remove-last">
            <button type="submit">Remove last</button>
          </form>
        </div>`,
  )
}

function ambiguitySection(chosen: Ambiguity, ranges: GrowthView['ranges'], form: AmbiguityForm): Section {
  const levels = AMBIGUITIES.map(
    (level) =>
      `            <label><input type="radio" name="ambiguity" value="${level}"${level === chosen ? ' checked' : ''} required> ${ambiguityName(level)} <span class="range">${ranges[level].low}–${ranges[level].high}×</span></label>`,
  ).join('\n')
  return inputSection(
    'Ambiguity',
    'Ambiguity',
    'How well the milestone’s work is understood. The less it is, the more the work may grow, by the ranges below.',
    `        <form method="post" action="/inputs/ambiguity">${errorLine(form.error)}
          <fieldset class="levels" aria-label="Ambiguity of the milestone">
${levels}
          </fieldset>
          <div class="actions"><button type="submit" class="primary">Save and forecast</button></div>
        </form>`,
  )
}

function growthSection(form: GrowthForm): Section {
  const rows = AMBIGUITIES.map((level) => {
    const field = (end: 'low' | 'high'): string =>
      `<input type="number" name="${level}-${end}" min="0" max="${MAX_GROWTH}" step="any" value="${escapeHtml(form.ranges[level][end])}" aria-label="${ambiguityName(level)} ambiguity, ${end} end" required>`
    return `              <tr>
                <td>${ambiguityName(level)}</td>
                <td>${field('low')} <span class="to">to</span> ${field('high')} <span class="unit">× the tickets remaining</span></td>
              </tr>`
  }).join('\n')
  return inputSection(
    'Growth',
    'Growth',
    'How much the work may grow at each ambiguity level. The milestone grows by the range of its own level.',
    `        <form method="post" action="/inputs/growth">${errorLine(form.error)}
          <table class="growth">
            <thead>
              <tr><th>Ambiguity</th><th>Grows by</th></tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
          <div class="actions"><button type="submit">Save ranges</button></div>
        </form>`,
  )
}
