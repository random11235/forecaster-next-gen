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

/**
 * A form posted: the edit it is, read from its fields, where the EM goes once it is done (`next`, from the place the
 * submit names), and, for a query step's, where it asks to confirm going back to finding clears its query.
 */
interface Posted {
  edit: Edit
  next: (place: Place, capacityOpen: boolean) => string
  confirmingBack?: string
}

/**
 * The form posted at `pathname`, read from `form`: the Inputs screen's and the Milestone forecast screen's, and, where
 * the handle `connects`, the setup steps' (the query steps', the Connect step's, skipping periods, setup's own and
 * Read again). None for any other request, or a form as no page of the app sends it.
 */
function postedForm(pathname: string, form: URLSearchParams, connects: boolean): Posted | undefined {
  const readInputs = INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)
  // a form from the open Capacity section goes back to the screen with it open
  if (readInputs)
    return {
      edit: { form: 'inputs', edit: readInputs(form) },
      next: ({ screen }, open) => (screen === 'forecast' && open ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen]),
    }
  if (!connects) return undefined
  const stepForm = STEP_FORMS.get(pathname)
  if (stepForm) {
    const edit = stepForm.read(form)
    const { setupStep, urls } = stepForm.section
    // a query edited by hand stays open for editing; every other change goes back to finding
    return (
      edit && {
        edit: { form: 'stepQuery', step: setupStep, edit },
        next: () => (edit.kind === 'editQuery' ? urls.editing : urls.finding),
        confirmingBack: urls.confirmingBack,
      }
    )
  }
  const readConnect = CONNECT_FORMS.get(pathname)
  if (readConnect) return { edit: { form: 'connection', edit: readConnect(form) }, next: placePath }
  const readSkip = SKIP_FORMS.get(pathname)
  // skipped or counted again, back to the tracker's pace
  if (readSkip) return { edit: { form: 'skip', edit: readSkip(form) }, next: () => PACE_TRACKER_PATH }
  const readSetupEdit = SETUP_FORMS.get(pathname)
  if (readSetupEdit) {
    const edit = readSetupEdit(form)
    return edit && { edit: { form: 'setup', edit }, next: placePath }
  }
  if (pathname === SETUP_PATHS.readAgain) return { edit: { form: 'readAgain' }, next: placePath }
  return undefined
}

/**
 * What a submit comes to, answered: a redirect to the place it goes next, or, saved in place, the Inputs screen; the
 * screen to show again, refused; or the step asking to confirm going back to finding clears its query.
 */
function outcomeReply(request: Request, outcome: Outcome, { next, confirmingBack }: Posted, capacityOpen: boolean): Reply {
  switch (outcome.kind) {
    case 'saved':
      return { kind: 'redirect', location: next(outcome.next, capacityOpen) }
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
  const list = kind && (await forecasting.searchedChoiceList(kind, searchParams.get(section.findField) ?? '', section.stepQuery))
  return list ? { kind: 'html', status: 200, html: choiceListHtml(list, section) } : { kind: 'notFound' }
}

/** Where a place is served: the setup step it names, at its section, or the screen. */
const placePath = ({ screen, step }: Place): string => (step ? SETUP_STEP_PATHS[step] : SCREEN_PATHS[screen])

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
