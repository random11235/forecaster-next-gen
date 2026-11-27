import {
  MAX_CADENCE_DAYS,
  MAX_GROWTH,
  type GrowthView,
  type InputsEdit,
  type CandidateOpening,
  type InputsScreen,
  type MilestoneInputsView,
  type QueryStep,
  type SkipEdit,
  type TypedForms,
  type TypedRange,
} from '../forecast/index.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import { CONNECT_HINT, connectSection } from './connectSection.js'
import { CHECK_SCRIPT, CHECK_STEP, checkStepHtml, noSetupHtml, setupSkippedHtml, setupStepHtml, setupSummaryHtml } from './setupSection.js'
import { escapeHtml, htmlPage } from './html.js'
import { INPUTS_SCRIPT } from './inputsScript.js'
import { candidatesHtml, candidatesScript } from './candidatesSection.js'
import { COMPARABLE_WORK_STEP, MILESTONE_STEP, queryStepScript, queryStepSection, type StepSection } from './queryStepSection.js'
import { errorLine, inputSection, radios, type FormError, type Section } from './lib/inputSection.js'
import { milestoneSection } from './lib/milestoneSection.js'
import { paceSection } from './lib/paceSection.js'

export { INPUT_LABELS } from './lib/inputSection.js'

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
  [
    '/inputs/pace-weeks',
    (body) => ({
      kind: 'setPaceCounts',
      counts: body
        .getAll('week')
        .map((week) => week.trim())
        .join(' '),
    }),
  ],
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

/** Where the tracker's pace is shown, which skipping its periods goes back to. */
export const PACE_TRACKER_PATH = '/inputs#pace-tracker'

/** The tracker's periods skipped, or counted again, each by the date it starts on, by its form's path: in the local server build. */
export const SKIP_FORMS: ReadonlyMap<string, (body: URLSearchParams) => SkipEdit> = new Map<string, (body: URLSearchParams) => SkipEdit>([
  ['/inputs/pace-skip', (body) => ({ kind: 'skip', periods: body.getAll('period') })],
  ['/inputs/pace-count-again', (body) => ({ kind: 'countAgain', periods: body.getAll('period') })],
])

/**
 * The Inputs screen: in the local server build, first its setup: the setup step the EM is on, the Connect step, the
 * query step the view shows (the Milestone step or the Comparable work step), or Check; or, once setup is closed, its
 * summary; in the browser build, that it reads no tracker. Then the milestone, its pace and the team's growth.
 */
export function renderInputsScreen(view: InputsScreen, keep: KeepOpening): string {
  const { inputs: screen, setup, step } = view
  const { milestone, forms } = screen
  const picker = step && shownStep(step, keep)
  const error: FormError = (form) => (screen.refusal?.form === form ? screen.refusal.error : undefined)
  const sections = [
    ...setupStepSection(view, picker),
    milestoneSection(screen, error),
    cadenceSection(forms.cadence, error('cadence'), milestone),
    paceSection(screen, error, milestone.period),
    ambiguitySection(milestone.ambiguity, screen.growth, error('ambiguity')),
    growthSection(forms.growth, screen.growth.names, error('growth')),
  ]
  const header = {
    context: milestone.name === '' ? undefined : escapeHtml(milestone.name),
    heading: 'Inputs',
    lede: 'What drives the forecast: the milestone, the team’s pace, and how work grows.',
  }
  // each script is a call, so one following another would be taken to call its result: `;` ends each (#275)
  const script = [INPUTS_SCRIPT, ...(setup?.kind === 'steps' && setup.step === 'check' ? [CHECK_SCRIPT] : []), ...(picker?.scripts ?? [])].join(';')
  const closed = setup?.kind === 'summary' ? setupSummaryHtml(setup) : setup?.kind === 'skipped' ? setupSkippedHtml() : setup === undefined ? noSetupHtml() : ''
  return htmlPage('/inputs', header, closed + sections.map((section, index) => section(index + 1)).join('\n'), script)
}

/**
 * Keeps the Comparable work step's candidates' opening (`ComparableWorkStep.candidates`, #205), for the page's script to
 * read more in, and gives the id it is kept under: `keepOpening`, which writes it to the openings kept. It is called
 * once for each render whose view has candidates, whether or not the screen then shows the step; calling it only when
 * the step is shown would keep fewer openings, and so drop the oldest later.
 */
export type KeepOpening = (opening: CandidateOpening) => string

/** A step picking or writing one of the team's queries, as the screen shows it: its section, its picker with the candidates it shows, and the picker's scripts. */
interface Picker {
  section: StepSection
  html: string
  scripts: string[]
}

function shownStep(view: QueryStep, keep: KeepOpening): Picker {
  if (view.kind === 'milestoneStep')
    return { section: MILESTONE_STEP, html: queryStepSection(view, MILESTONE_STEP), scripts: [queryStepScript(MILESTONE_STEP)] }
  const section = COMPARABLE_WORK_STEP
  const { candidates } = view
  const shown = candidates ? candidatesHtml(candidates.shown, keep(candidates.opening), section) : ''
  return { section, html: queryStepSection(view, section) + shown, scripts: [queryStepScript(section), ...(candidates ? [candidatesScript(section)] : [])] }
}

/** The setup step the EM is on, as its section, with the steps' list and Back and Next; none once setup is closed, or in the browser build. */
function setupStepSection({ setup, connection }: Pick<InputsScreen, 'setup' | 'connection'>, picker: Picker | undefined): Section[] {
  if (setup?.kind !== 'steps') return []
  const step = (label: string, hint: string, body: string, id: string): Section[] => [
    inputSection(label, label, hint, setupStepHtml(setup, body), { postsOnSubmit: true, id }),
  ]
  switch (setup.step) {
    case 'connect': {
      return connection === undefined ? [] : step('Connect', CONNECT_HINT, connectSection(connection), 'connect')
    }
    case 'check':
      return step(CHECK_STEP.title, CHECK_STEP.hint, checkStepHtml(setup.check), CHECK_STEP.id)
    case 'milestone':
    case 'comparableWork': {
      if (picker?.section.setupStep !== setup.step) return []
      const { section, html } = picker
      return step(section.title, section.hint, html, section.id)
    }
  }
}

function cadenceSection(form: TypedForms['cadence'], error: string | undefined, saved: Pick<MilestoneInputsView, 'cadenceDays' | 'period'>): Section {
  return inputSection(
    'Cadence',
    'Cadence',
    cadenceHint(saved),
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
function cadenceHint({ cadenceDays, period }: Pick<MilestoneInputsView, 'cadenceDays' | 'period'>): string {
  const lasts = 'How many days one of the team’s periods lasts.'
  return period === 'week'
    ? `${lasts} At 7 days a period is a week, so pace is entered per week; any other length makes it a sprint.`
    : `${lasts} At ${cadenceDays} days a period is a sprint, so pace is entered per sprint; 7 days makes it a week.`
}

function ambiguitySection(chosen: Ambiguity, { ranges, names }: GrowthView, error: string | undefined): Section {
  const level = (level: Ambiguity): string => `${names[level]} <span class="range">${ranges[level].low}–${ranges[level].high}×</span>`
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

function growthSection(form: TypedForms['growth'], names: GrowthView['names'], error: string | undefined): Section {
  const rows = AMBIGUITIES.map((level) => {
    const field = (end: 'low' | 'high'): string =>
      `<input type="number" name="${level}-${end}" min="0" max="${MAX_GROWTH}" step="any" value="${escapeHtml(form[level][end])}" aria-label="${names[level]} ambiguity, ${end} end" required>`
    return `              <tr>
                <td>${names[level]}</td>
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
