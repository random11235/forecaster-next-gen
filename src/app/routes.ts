import { choiceKindOf } from '../model/choice.js'
import type { Edit, Forecasting, InputsOpening, InputsScreen, NextScreen, Outcome, Place } from '../forecast/index.js'
import { CONNECT_FORMS } from './connectSection.js'
import { renderHowItWorksScreen } from './howItWorksScreen.js'
import { INPUTS_FORMS, PACE_TRACKER_PATH, renderInputsScreen, SKIP_FORMS } from './inputsScreen.js'
import { CAPACITY_OPEN, CAPACITY_OPEN_PATH, FORECAST_FORMS, renderMilestoneForecastScreen } from './milestoneForecastScreen.js'
import {
  choiceListHtml,
  COMPARABLE_WORK_STEP,
  CONFIRMING_BACK,
  KIND_FIELD,
  MILESTONE_STEP,
  OPEN_FIELD,
  STEP_FORMS,
  STEP_SECTIONS,
  type StepSection,
} from './queryStepSection.js'
import { SETUP_FORMS, SETUP_PATHS, SETUP_STEP_PATHS, STEP_FIELD } from './setupSection.js'
import { CANDIDATES_PATH, candidatesHtml, choicesAsked, keepOpening, OPENING_FIELD, openingKept } from './candidatesSection.js'
import type { Reply, Request } from './appContext.js'

/**
 * The Milestone forecast screen at `/`, the Inputs screen at `/inputs` and How it works at `/how-it-works`, and the
 * forms they post; not found for everything else. The setup steps' requests are answered only where the handle
 * connects a tracker (the local server build). Each request makes one call of the handle.
 */
export async function route(request: Request, forecasting: Forecasting): Promise<Reply> {
  const { pathname, searchParams } = new URL(request.path, 'http://app')
  const opening = openingOf(searchParams)
  if (request.method === 'GET' && pathname === '/') {
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(await forecasting.milestoneForecastView(opening)) }
  }
  if (request.method === 'GET' && pathname === '/how-it-works') {
    return { kind: 'html', status: 200, html: renderHowItWorksScreen(await forecasting.howItWorksView()) }
  }
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) return inputsReply(request, 200, await forecasting.inputsScreen(opening))
  if (request.method === 'GET' && forecasting.connects) {
    const searchedFor = STEP_SECTIONS.find((section) => section.searchedChoicesPath === pathname)
    if (searchedFor) return searchedChoices(forecasting, searchParams, searchedFor)
    if (pathname === CANDIDATES_PATH) return candidatesAsked(forecasting, searchParams)
  }
  const posted = request.method === 'POST' ? postedForm(pathname, request.form ?? new URLSearchParams(), forecasting.connects) : undefined
  if (!posted) return { kind: 'notFound' }
  const outcome = await forecasting.submit(posted.edit, { ...opening, inPlace: request.saveInPlace === true })
  return outcomeReply(request, outcome, posted, opening.capacityOpen === true)
}

/** How the Inputs screen, or the Milestone forecast screen, opens, as its URL asks. */
function openingOf(searchParams: URLSearchParams): InputsOpening {
  const editing = STEP_SECTIONS.find(({ editing }) => searchParams.get(editing.name) === editing.value)
  const find = STEP_SECTIONS.flatMap(({ setupStep, findField }) => {
    const typed = searchParams.get(findField)
    return typed === null ? [] : [[setupStep, typed] as const]
  })
  return {
    step: searchParams.get(STEP_FIELD),
    ...(editing && { editing: editing.setupStep }),
    confirmingBack: searchParams.get(CONFIRMING_BACK.name) === CONFIRMING_BACK.value,
    opened: searchParams.getAll(OPEN_FIELD),
    find: Object.fromEntries(find),
    // the Capacity section's open state travels in the URL, and its forms carry it
    capacityOpen: searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value,
  }
}

/** A form posted: the edit it is, read from its fields, and, for a query step's, where it asks to confirm going back to finding clears its query. */
interface Posted {
  edit: Edit
  confirmingBack?: string
}

/**
 * The form posted at `pathname`, read from `form`: the Inputs screen's and the Milestone forecast screen's, and, where
 * the handle `connects`, the setup steps' (the query steps', the Connect step's, skipping periods, setup's own and
 * Read again). None for any other request, or a form as no page of the app sends it.
 */
function postedForm(pathname: string, form: URLSearchParams, connects: boolean): Posted | undefined {
  const readInputs = INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)
  if (readInputs) return { edit: { form: 'inputs', edit: readInputs(form) } }
  if (!connects) return undefined
  const stepForm = STEP_FORMS.get(pathname)
  if (stepForm) {
    const edit = stepForm.read(form)
    const { setupStep, urls } = stepForm.section
    return edit && { edit: { form: 'stepQuery', step: setupStep, edit }, confirmingBack: urls.confirmingBack }
  }
  const readConnect = CONNECT_FORMS.get(pathname)
  if (readConnect) return { edit: { form: 'connection', edit: readConnect(form) } }
  const readSkip = SKIP_FORMS.get(pathname)
  if (readSkip) return { edit: { form: 'skip', edit: readSkip(form) } }
  const readSetupEdit = SETUP_FORMS.get(pathname)
  if (readSetupEdit) {
    const edit = readSetupEdit(form)
    return edit && { edit: { form: 'setup', edit } }
  }
  if (pathname === SETUP_PATHS.readAgain) return { edit: { form: 'readAgain' } }
  return undefined
}

/**
 * What a submit comes to, answered: a redirect to the place it goes next, saved or, for setup's own forms, not; saved
 * in place, the Inputs screen; the screen to show again, refused; or the step asking to confirm going back to finding
 * clears its query.
 */
function outcomeReply(request: Request, outcome: Outcome, { confirmingBack }: Posted, capacityOpen: boolean): Reply {
  switch (outcome.kind) {
    case 'saved':
    case 'notSaved':
      return { kind: 'redirect', location: placePath(outcome.next, capacityOpen) }
    case 'savedInPlace':
      return inputsReply(request, 200, outcome.view)
    case 'confirmClear':
      return { kind: 'redirect', location: confirmingBack ?? SCREEN_PATHS.inputs }
    case 'refused':
      return inputsReply(request, 400, outcome.view)
    case 'refusedOnForecast': {
      const path = capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS.forecast
      return { kind: 'html', status: 400, html: renderMilestoneForecastScreen(outcome.view), path }
    }
  }
}

/** The Inputs screen, served at `/inputs` with `status`; its candidates' opening kept for the page's script to read more in. */
function inputsReply(request: Request, status: number, screen: InputsScreen): Reply {
  const { step } = screen
  const section = step && (step.kind === 'milestoneStep' ? MILESTONE_STEP : COMPARABLE_WORK_STEP)
  const candidates = step?.kind === 'comparableWorkStep' && step.candidates
  const shown = section && step && { section, view: step, ...(candidates && { openingId: keepOpening(candidates.opening) }) }
  const html = renderInputsScreen(screen, shown)
  return { kind: 'html', status, html, ...(request.method === 'POST' && { path: SCREEN_PATHS.inputs }) }
}

/** The candidates the Comparable work step's script asks for, in the opening it names: the candidates block alone. */
async function candidatesAsked(forecasting: Forecasting, searchParams: URLSearchParams): Promise<Reply> {
  const choices = choicesAsked(searchParams, choiceKindOf)
  if (!choices) return { kind: 'notFound' }
  const opening = await openingKept(searchParams.get(OPENING_FIELD) ?? '', () => forecasting.openCandidates())
  const candidates = await opening.read(choices)
  return { kind: 'html', status: 200, html: candidatesHtml(candidates, searchParams.get(OPENING_FIELD) ?? '', COMPARABLE_WORK_STEP) }
}

/** One kind's choices searched in the tracker, as a query step's script asks for them: that kind's list alone. */
async function searchedChoices(forecasting: Forecasting, searchParams: URLSearchParams, section: StepSection): Promise<Reply> {
  const kind = choiceKindOf(searchParams.get(KIND_FIELD) ?? '')
  const list = kind && (await forecasting.searchedChoiceList(kind, searchParams.get(section.findField) ?? '', section.setupStep))
  return list ? { kind: 'html', status: 200, html: choiceListHtml(list, section) } : { kind: 'notFound' }
}

/**
 * Where a place is served: the tracker's pace; the setup step it names, at its section, with its query open for
 * editing if it says so; or the screen, the Milestone forecast screen with its Capacity section open when the form
 * posted came from there.
 */
function placePath({ screen, step, editing, paceTracker }: Place, capacityOpen: boolean): string {
  if (paceTracker) return PACE_TRACKER_PATH
  const editingAt = editing && STEP_SECTIONS.find(({ setupStep }) => setupStep === step)
  if (editingAt) return editingAt.urls.editing
  if (step) return SETUP_STEP_PATHS[step]
  return screen === 'forecast' && capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen]
}

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
