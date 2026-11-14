import { periodName, type PeriodName } from '../forecast/cadence.js'
import type { InputNote, MilestoneInput } from '../forecast/milestoneAssessment.js'
import {
  MAX_CADENCE_DAYS,
  MAX_TICKETS_PER_PERIOD,
  MAX_TICKETS_REMAINING,
  type PaceSourceView,
  type ReadsDifferently,
  type TicketsSourceView,
} from '../forecast/milestoneInputs.js'
import { ambiguityName, MAX_GROWTH, type GrowthView, type TypedRange } from '../forecast/growth.js'
import type { ConnectionView } from '../forecast/connection.js'
import type { QueryStepView } from '../forecast/queryStep.js'
import type { InputsEdit, InputsForm, InputsView, TypedForms } from '../forecast/inputs.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import type { PaceMode, TicketsSource } from '../model/milestoneInputs.js'
import { CONNECT_HINT, connectSection } from './connectSection.js'
import { dayMonth } from '../forecast/calendarDate.js'
import { escapeHtml, htmlPage } from './html.js'
import { INPUTS_SCRIPT } from './inputsScript.js'
import { candidatesHtml, candidatesScript } from './candidatesSection.js'
import { queryStepScript, queryStepSection, type StepSection } from './queryStepSection.js'
import { renderPaceTrend } from './paceTrendGraph.js'

/** Each input of the milestone by its label on this screen, which notes about it are named by everywhere. */
export const INPUT_LABELS: Record<MilestoneInput, string> = {
  name: 'Name',
  startDate: 'Start date',
  ticketsRemaining: 'Tickets remaining',
  pace: 'Pace',
  typedCounts: 'Typed counts',
}

/** Reads a submitted form's fields, by the field names this screen gives them; the rules they must meet are checked when it is saved. */
type FormReader = (body: URLSearchParams) => InputsEdit

/** Each form this screen posts, by its action's path, and how its fields are read. */
export const INPUTS_FORMS: ReadonlyMap<string, FormReader> = new Map<string, FormReader>([
  [
    '/inputs/milestone',
    (body) => ({
      kind: 'setMilestone',
      name: body.get('name') ?? '',
      startDate: body.get('startDate')?.trim() ?? '',
      // no field while tickets remaining follows the tracker
      ticketsRemaining: body.get('ticketsRemaining')?.trim(),
    }),
  ],
  ['/inputs/tickets-source', (body) => ({ kind: 'setTicketsSource', ticketsSource: body.get('ticketsSource') ?? '' })],
  // a chip opened: its reading is seen, and its dot clears (see `inputsScript.ts`)
  ['/inputs/reading-opened', (body) => ({ kind: 'openReading', reading: body.get('reading') ?? '' })],
  ['/inputs/cadence', (body) => ({ kind: 'setCadence', cadenceDays: body.get('cadenceDays')?.trim() ?? '' })],
  ['/inputs/pace', (body) => ({ kind: 'setPaceRange', low: body.get('low')?.trim() ?? '', high: body.get('high')?.trim() ?? '' })],
  ['/inputs/pace-mode', (body) => ({ kind: 'setPaceMode', paceMode: body.get('paceMode') ?? '' })],
  ['/inputs/pace-counts', (body) => ({ kind: 'setPaceCounts', counts: body.get('counts')?.trim() ?? '' })],
  // the tracker's weeks as blocks, opened and typed into: the typed counts, oldest first
  ['/inputs/pace-weeks', (body) => ({ kind: 'setPaceCounts', counts: body.getAll('week').map((week) => week.trim()).join(' ') })],
  ['/inputs/pace-counts/add', (body) => ({ kind: 'addPaceCount', count: body.get('count')?.trim() ?? '' })],
  ['/inputs/pace-counts/remove-last', () => ({ kind: 'removeLastPaceCount' })],
  ['/inputs/ambiguity', (body) => ({ kind: 'setAmbiguity', level: body.get('ambiguity') ?? '' })],
  [
    '/inputs/growth',
    (body) => {
      const typed = (level: Ambiguity): TypedRange => ({ low: body.get(`${level}-low`) ?? '', high: body.get(`${level}-high`) ?? '' })
      return { kind: 'setAmbiguityRanges', low: typed('low'), medium: typed('medium'), high: typed('high') }
    },
  ],
])

/** A step picking or writing one of the team's queries, as the Inputs screen shows it: its section, and its view. */
export interface ShownStep {
  section: StepSection
  view: QueryStepView
  /**
   * The id its candidates' opening is kept by, for the page's script to read more in (`keepOpening`): the Comparable work
   * step's, while it shows candidates (`ComparableWorkStep.candidates`, #205).
   */
  openingId?: string
}

/**
 * The Inputs screen: in the local server build the Connect step first, and once connected the `steps` picking the
 * team's queries, the Milestone step and then the Comparable work step; then the milestone, its pace and the team's
 * growth.
 */
export function renderInputsScreen(screen: InputsView, connection: ConnectionView, steps: readonly ShownStep[] = []): string {
  const { milestone, forms } = screen
  const error = (form: InputsForm): string | undefined => (screen.refusal?.form === form ? screen.refusal.error : undefined)
  const connect = connectSection(connection)
  const pickers = steps.flatMap(({ section, view, openingId }) => {
    const picker = queryStepSection(view, section)
    const candidates = view.kind === 'comparableWorkStep' && view.candidates && openingId !== undefined ? candidatesHtml(view.candidates.shown, openingId, section) : ''
    return picker === undefined ? [] : [{ section, picker: picker + candidates }]
  })
  const sections = [
    ...(connect === undefined ? [] : [inputSection('Connect', 'Connect', CONNECT_HINT, connect, { postsOnSubmit: true })]),
    ...pickers.map(({ section, picker }) => inputSection(section.title, section.title, section.hint, picker, { postsOnSubmit: true, id: section.id })),
    milestoneSection(forms.milestone, milestone.ticketsSource, error, milestone.notes),
    cadenceSection(forms.cadence, error('cadence'), milestone.cadenceDays),
    paceSection(screen, error, periodName(milestone.cadenceDays)),
    ambiguitySection(milestone.ambiguity, screen.growth.ranges, error('ambiguity')),
    growthSection(forms.growth, error('growth')),
  ]
  const header = {
    context: milestone.name === '' ? undefined : escapeHtml(milestone.name),
    heading: 'Inputs',
    lede: 'What drives the forecast: the milestone, the team’s pace, and how work grows.',
  }
  const script =
    INPUTS_SCRIPT +
    pickers.map(({ section }) => queryStepScript(section)).join('') +
    steps.filter(({ openingId }) => openingId !== undefined).map(({ section }) => candidatesScript(section)).join('')
  return htmlPage('/inputs', header, sections.map((section, index) => section(index + 1)).join('\n'), script)
}

/** A section of the Inputs screen, given its number on the screen. */
type Section = (number: number) => string

/**
 * A numbered section: its name and hint in the label column, `body` beside them. One that `postsOnSubmit` posts only when
 * its button is pressed; the others save each input as it changes (see `inputsScript.ts`).
 */
function inputSection(label: string, name: string, hint: string, body: string, { postsOnSubmit = false, id = label.toLowerCase() } = {}): Section {
  return (number) => `    <section class="input${postsOnSubmit ? ' submits' : ''}" id="${id}" aria-label="${label}">
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

/**
 * The milestone's name, start date and tickets remaining. With a connection, tickets remaining has a source to choose
 * (`ticketsSource`): following the tracker, it shows the latest read's count, with no field to type in; typed, the
 * field as in the MVP. The source's radios sit by the field but post their own form, saved as soon as one is chosen.
 */
function milestoneSection(
  form: TypedForms['milestone'],
  ticketsSource: TicketsSourceView | undefined,
  error: (form: InputsForm) => string | undefined,
  notes: readonly InputNote[],
): Section {
  const following = ticketsSource?.source === 'tracker'
  const typedField = `<label>${INPUT_LABELS.ticketsRemaining} <input type="number" name="ticketsRemaining" min="0" max="${MAX_TICKETS_REMAINING}" step="1" value="${escapeHtml(form.ticketsRemaining)}" required></label>`
  const tickets = ticketsSource
    ? `<div class="tickets-source">
              ${radios('ticketsSource', `Where ${INPUT_LABELS.ticketsRemaining.toLowerCase()} comes from`, TICKETS_SOURCES, ticketsSource.source, (source) => (source === 'tracker' ? escapeHtml(ticketsSource.tracker) : 'Typed'), { form: TICKETS_SOURCE_FORM }).trim()}
              ${following ? trackerTickets(ticketsSource) : typedField + ticketsChip(ticketsSource)}
            </div>`
    : typedField
  return inputSection(
    'Milestone',
    'Milestone',
    'Name the milestone, the date work on it starts, and how many tickets are left.',
    `        <form method="post" action="/inputs/milestone#milestone">${errorLine(error('milestone'))}
          <div class="fields">
            <label class="wide">${INPUT_LABELS.name} <input type="text" name="name" value="${escapeHtml(form.name)}" required></label>${notesFor('name', notes)}
            <label>${INPUT_LABELS.startDate} <input type="date" name="startDate" value="${escapeHtml(form.startDate)}" required></label>${notesFor('startDate', notes)}
            ${tickets}${notesFor('ticketsRemaining', notes)}
          </div>
          <div class="actions"><button type="submit" class="primary">Save milestone</button></div>
        </form>${
          ticketsSource
            ? `
        <form method="post" action="/inputs/tickets-source#milestone" id="${TICKETS_SOURCE_FORM}">${errorLine(error('ticketsSource'))}
          <div class="actions"><button type="submit">Use this source</button></div>
        </form>${
          // opening a reading is posted by the page's script, which shows no reply; a refusal shows here, by the first chip
          errorLine(error('readingOpened'))
        }${ticketsSource.readsDifferently ? chipForms(TICKETS_CHIP, '/inputs/tickets-source#milestone', { ticketsSource: 'tracker' }) : ''}`
            : ''
        }`,
  )
}

const TICKETS_SOURCE_FORM = 'tickets-source'
const TICKETS_SOURCES: readonly TicketsSource[] = ['tracker', 'typed']

/** Tickets remaining typed, with its chip when the tracker reads it differently. */
function ticketsChip({ tracker, reading, readsDifferently }: TicketsSourceView): string {
  if (!readsDifferently || !reading) return ''
  const incomplete = reading.incomplete ? ' <span class="incomplete">incomplete</span>' : ''
  return `
              ${chip(TICKETS_CHIP, tracker, readsDifferently, `<p>${escapeHtml(tracker)} reads <b>${reading.count}</b> tickets remaining, read ${escapeHtml(reading.readOn)}.${incomplete}</p>`)}`
}

/** A chip: what its forms are ids from, and which value's reading it opens. */
interface Chip {
  id: string
  reading: 'ticketsRemaining' | 'pace'
}

const TICKETS_CHIP: Chip = { id: 'tickets', reading: 'ticketsRemaining' }
const PACE_CHIP: Chip = { id: 'pace', reading: 'pace' }

/**
 * The chip on a typed value the tracker reads differently: "GitHub reads differently", with a dot while its latest
 * read is unopened. Opened, it shows the `reading` and offers Follow, which posts the form switching the value back to
 * the tracker; the page's script posts that it was opened, clearing the dot. Its forms sit outside the form the value
 * is in (`chipForms`), as forms don't nest.
 */
function chip({ id, reading }: Chip, tracker: string, { unseen }: ReadsDifferently, body: string): string {
  const opens = unseen ? ` data-opens="open-${id}-reading"` : ''
  const dot = unseen ? '<span class="dot" title="A read you haven’t opened"></span>' : ''
  return `<details class="chip"${opens} data-reading="${reading}">
                <summary>${dot}${escapeHtml(tracker)} reads differently</summary>
                <div class="chip-panel">
                  ${body}
                  <div class="chip-actions"><button type="submit" form="follow-${id}" class="primary">Follow ${escapeHtml(tracker)}</button></div>
                </div>
              </details>`
}

/** A chip's forms: Follow, posting `fields` to `action`; and opening its reading, which the page's script posts. */
function chipForms({ id, reading }: Chip, action: string, fields: Record<string, string>): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`)
    .join('')
  return `
        <form method="post" action="${action}" id="follow-${id}">
          ${hidden}
        </form>
        <form method="post" action="/inputs/reading-opened#${action.split('#')[1]}" id="open-${id}-reading">
          <input type="hidden" name="reading" value="${reading}">
        </form>`
}

/** Tickets remaining as the tracker last read it, and when; marked incomplete when the read was part of the tickets. */
function trackerTickets({ tracker, reading }: TicketsSourceView): string {
  if (!reading) return `<p class="reading"><span class="reading-line">tickets remaining · ${escapeHtml(tracker)}, not read yet</span></p>`
  const incomplete = reading.incomplete ? ' <span class="incomplete">incomplete</span>' : ''
  return `<p class="reading"><span class="reading-value">${reading.count}</span>${incomplete}
              <span class="reading-line">tickets remaining · ${escapeHtml(tracker)}, read ${escapeHtml(reading.readOn)}</span></p>`
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

function cadenceSection(form: TypedForms['cadence'], error: string | undefined, savedDays: number): Section {
  return inputSection(
    'Cadence',
    'Cadence',
    cadenceHint(savedDays),
    `        <form method="post" action="/inputs/cadence#cadence">${errorLine(error)}
          <div class="pace">
            <label>Cadence length <input type="number" name="cadenceDays" min="1" max="${MAX_CADENCE_DAYS}" step="1" value="${escapeHtml(form.cadenceDays)}" required></label>
            <span class="unit">days</span>
          </div>
          <div class="actions"><button type="submit">Save cadence</button></div>
        </form>`,
  )
}

/** What the saved cadence makes a period, which pace is entered per, and what the other lengths make it. */
function cadenceHint(savedDays: number): string {
  const lasts = 'How many days one of the team’s periods lasts.'
  return periodName(savedDays) === 'week'
    ? `${lasts} At 7 days a period is a week, so pace is entered per week; any other length makes it a sprint.`
    : `${lasts} At ${savedDays} days a period is a sprint, so pace is entered per sprint; 7 days makes it a week.`
}

/** Each pace's name; the tracker's is the connected tracker's own, GitHub or Jira. */
const PACE_MODE_NAMES: Record<Exclude<PaceMode, 'tracker'>, string> = { range: 'Range', counts: INPUT_LABELS.typedCounts }

/**
 * The pace: which one the forecast uses, the tracker's with a connection, the range, and the typed counts, the notes
 * and the trend beside the one in use.
 */
function paceSection(screen: InputsView, error: (form: InputsForm) => string | undefined, period: PeriodName): Section {
  const { paceMode, paceSource, notes, typedCountsNeeded: typedCounts, paceTrend } = screen.milestone
  // with no connection to follow, pace following the tracker uses the typed counts
  const inUse: PaceMode = paceMode === 'tracker' && !paceSource ? 'counts' : paceMode
  const notesIfUsed = (mode: PaceMode): string => (mode === inUse ? notesFor('pace', notes) + notesFor('typedCounts', notes) : '')
  const trendIfUsed = (mode: PaceMode): string => (mode === inUse ? renderPaceTrend(paceTrend, period, '          ') : '')
  const { paceRange: range, paceCounts: counts } = screen.forms
  const chipIfUsed = (mode: PaceMode): string => (mode === inUse ? paceChip(paceSource, period) : '')
  const modes: readonly PaceMode[] = paceSource ? ['tracker', 'counts', 'range'] : ['range', 'counts']
  const name = (mode: PaceMode): string => (mode === 'tracker' ? escapeHtml(paceSource?.tracker ?? '') : PACE_MODE_NAMES[mode])
  const tracker = paceSource
    ? `
        <div class="pace-following" id="pace-tracker">
          <h3>${escapeHtml(paceSource.tracker)}</h3>${trackerPace(paceSource, period, inUse === 'tracker')}${notesIfUsed('tracker')}${trendIfUsed('tracker')}
        </div>`
    : ''
  return inputSection(
    INPUT_LABELS.pace,
    INPUT_LABELS.pace,
    `How many tickets the team finishes in a ${period}: ${paceSource ? `the ${period}s ${escapeHtml(paceSource.tracker)} reads, ` : ''}a range from a slow ${period} to a good one, or typed counts of past ${period}s. Typed counts need at least ${typedCounts.forForecast} for a forecast, and ${typedCounts.reliable} to be reliable. Capacity is set beside the forecast, under Pace.`,
    `        <form method="post" action="/inputs/pace-mode#pace">${errorLine(error('paceMode'))}
${radios('paceMode', 'Pace the forecast uses', modes, paceMode, name)}
          <div class="actions"><button type="submit" class="primary">Use this pace</button></div>
        </form>${paceSource?.readsDifferently ? chipForms(PACE_CHIP, '/inputs/pace-mode#pace', { paceMode: 'tracker' }) : ''}${tracker}
        <form method="post" action="/inputs/pace#pace-range" id="pace-range">${errorLine(error('paceRange'))}
          <h3>${PACE_MODE_NAMES.range}</h3>
          <div class="pace">
            <label>Low <input type="number" name="low" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${escapeHtml(range.low)}" required></label>
            <span class="to">to</span>
            <label>High <input type="number" name="high" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${escapeHtml(range.high)}" required></label>
            <span class="unit">tickets per ${period}</span>${chipIfUsed('range')}
          </div>${notesIfUsed('range')}
          <div class="actions"><button type="submit" class="primary">Save and forecast</button></div>
        </form>
        <form method="post" action="/inputs/pace-counts#pace-counts" id="pace-counts">${errorLine(error('paceCounts'))}
          <h3>${PACE_MODE_NAMES.counts}</h3>
          <div class="fields">
            <label class="wide">Tickets done each ${period}, oldest first <input type="text" name="counts" value="${escapeHtml(counts.counts)}" inputmode="numeric" placeholder="6, 4, 9"></label>${chipIfUsed('counts')}
          </div>${notesIfUsed('counts')}${trendIfUsed('counts')}
          <div class="actions"><button type="submit">Save counts</button></div>
        </form>
        <div class="counts">
          <form method="post" action="/inputs/pace-counts/add#pace-counts">
            <div class="fields">
              <label>Newest ${period} <input type="number" name="count" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${escapeHtml(counts.count)}" required></label>
              <button type="submit">Add count</button>
            </div>
          </form>
          <form method="post" action="/inputs/pace-counts/remove-last#pace-counts">
            <button type="submit">Remove last</button>
          </form>
        </div>`,
  )
}

/** The typed counts or the range in use, with its chip when the tracker reads pace differently: its periods' counts as bars. */
function paceChip(paceSource: PaceSourceView | undefined, period: PeriodName): string {
  if (!paceSource?.readsDifferently || !paceSource.reading) return ''
  const { tracker, readsDifferently } = paceSource
  return `
            <span class="unit">${chip(PACE_CHIP, tracker, readsDifferently, `<p>${escapeHtml(tracker)} reads these ${period}s:</p>${trackerPace(paceSource, period, false)}`)}</span>`
}

/**
 * The tracker's pace: its counts as bars, oldest first, a quiet period a red stub, with the periods counted and when
 * they were read. While pace follows it (`following`), its periods sit behind Show weeks as blocks to type into, each
 * holding its count: typing into one posts them all as typed counts, which switches pace to them.
 */
function trackerPace({ tracker, reading }: PaceSourceView, period: PeriodName, following: boolean): string {
  if (!reading) return `\n          <p class="reading-line">${period}s finished · ${escapeHtml(tracker)}, not read yet</p>`
  const { window, periods, firstFinished, readOn } = reading
  const lines = `
          <p class="reading-line">${escapeHtml(periods)} · read ${escapeHtml(readOn)}</p>${firstFinished ? `\n          <p class="reading-line">${escapeHtml(firstFinished)}</p>` : ''}`
  if (window.counts.length === 0) return lines
  const tallest = Math.max(1, ...window.counts)
  const bars = window.counts
    .map((count, at) =>
      count === 0
        ? `<span class="bar zero" title="${period} of ${dayMonth(window.starts[at]!)}: 0"><span class="v">0</span></span>`
        : `<span class="bar" style="height: ${Math.round((count / tallest) * 100)}%" title="${period} of ${dayMonth(window.starts[at]!)}: ${count}"><span class="v">${count}</span></span>`,
    )
    .join('')
  const graph = `
          <div class="pace-bars" role="img" aria-label="Finished tickets per ${period}, oldest first: ${window.counts.join(', ')}">${bars}</div>`
  if (!following) return graph + lines
  const blocks = window.counts
    .map(
      (count, at) =>
        `<label>${dayMonth(window.starts[at]!)} <input type="number" name="week" min="0" max="${MAX_TICKETS_PER_PERIOD}" step="1" value="${count}" required></label>`,
    )
    .join('\n              ')
  return `${graph}${lines}
          <details class="week-blocks">
            <summary>Show ${period}s</summary>
            <form method="post" action="/inputs/pace-weeks#pace-counts">
              <p class="hint">Typing into a ${period} switches pace to typed counts, starting from these.</p>
              <div class="blocks">
              ${blocks}
              </div>
              <div class="actions"><button type="submit">Use as typed counts</button></div>
            </form>
          </details>`
}

/**
 * One of `options` to choose, as radio buttons named `name` with the chosen one checked; `label` is each one's HTML.
 * They post the form they are in, or the one whose id is `form`.
 */
function radios<T extends string>(
  name: string,
  ariaLabel: string,
  options: readonly T[],
  chosen: T,
  label: (option: T) => string,
  { form }: { form?: string } = {},
): string {
  const owner = form === undefined ? '' : ` form="${form}"`
  const buttons = options.map(
    (option) =>
      `            <label><input type="radio" name="${name}" value="${option}"${option === chosen ? ' checked' : ''}${owner} required> ${label(option)}</label>`,
  )
  return `          <fieldset class="levels" aria-label="${ariaLabel}">
${buttons.join('\n')}
          </fieldset>`
}

function ambiguitySection(chosen: Ambiguity, ranges: GrowthView['ranges'], error: string | undefined): Section {
  const level = (level: Ambiguity): string => `${ambiguityName(level)} <span class="range">${ranges[level].low}–${ranges[level].high}×</span>`
  return inputSection(
    'Ambiguity',
    'Ambiguity',
    'How well the milestone’s work is understood. The less it is, the more the work may grow, by the ranges below.',
    `        <form method="post" action="/inputs/ambiguity#ambiguity">${errorLine(error)}
${radios('ambiguity', 'Ambiguity of the milestone', AMBIGUITIES, chosen, level)}
          <div class="actions"><button type="submit" class="primary">Save and forecast</button></div>
        </form>`,
  )
}

function growthSection(form: TypedForms['growth'], error: string | undefined): Section {
  const rows = AMBIGUITIES.map((level) => {
    const field = (end: 'low' | 'high'): string =>
      `<input type="number" name="${level}-${end}" min="0" max="${MAX_GROWTH}" step="any" value="${escapeHtml(form[level][end])}" aria-label="${ambiguityName(level)} ambiguity, ${end} end" required>`
    return `              <tr>
                <td>${ambiguityName(level)}</td>
                <td>${field('low')} <span class="to">to</span> ${field('high')} <span class="unit">× the tickets remaining</span></td>
              </tr>`
  }).join('\n')
  return inputSection(
    'Growth',
    'Growth',
    'How much the work may grow at each ambiguity level. The milestone grows by the range of its own level. Each simulation picks one growth from the range, every value in it equally likely, and multiplies the tickets remaining by it before working through them at the team’s pace. A wider range spreads the finish dates out.',
    `        <form method="post" action="/inputs/growth#growth">${errorLine(error)}
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
