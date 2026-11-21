import { choiceKindOf } from '../model/choice.js'
import type { ConnectionEdit, ConnectionView } from '../forecast/connection.js'
import type { Forecasting } from '../forecast/forecasting.js'
import type { SkipEdit } from '../forecast/skippedPeriods.js'
import type { StepQueryEdit, QueryStepOpening, RefusedQuery } from '../forecast/queryStep.js'
import type { InputsView, NextScreen } from '../forecast/inputs.js'
import type { SetupEdit } from '../forecast/setup.js'
import { CONNECT_FORMS } from './connectSection.js'
import { renderHowItWorksScreen } from './howItWorksScreen.js'
import { INPUTS_FORMS, PACE_TRACKER_PATH, renderInputsScreen, SKIP_FORMS, type ShownStep } from './inputsScreen.js'
import { CAPACITY_OPEN, CAPACITY_OPEN_PATH, FORECAST_FORMS, renderMilestoneForecastScreen } from './milestoneForecastScreen.js'
import {
  choiceListHtml,
  COMPARABLE_WORK_STEP,
  CONFIRMING_BACK,
  KIND_FIELD,
  OPEN_FIELD,
  STEP_FORMS,
  STEP_SECTIONS,
  type StepSection,
} from './queryStepSection.js'
import { SETUP_FORMS, SETUP_PATHS, SETUP_STEP_PATHS, STEP_FIELD } from './setupSection.js'
import { CANDIDATES_PATH, candidatesHtml, choicesAsked, keepOpening, OPENING_FIELD, openingKept } from './candidatesSection.js'
import type { Reply, Request } from './appContext.js'

/** A request, routed: the team's handle, and the path asked for. */
interface Routing {
  forecasting: Forecasting
  request: Request
  pathname: string
  searchParams: URLSearchParams
}

/**
 * The Milestone forecast screen at `/`, the Inputs screen at `/inputs` and How it works at `/how-it-works`, and the
 * forms they post; not found for everything else. The setup steps' requests are answered only where the handle
 * connects a tracker (the local server build): the Inputs screen's Connect, Milestone and Comparable work steps, each
 * answered once the tracker has been asked.
 */
export async function route(request: Request, forecasting: Forecasting): Promise<Reply> {
  const { pathname, searchParams } = new URL(request.path, 'http://app')
  const routing: Routing = { forecasting, request, pathname, searchParams }
  if (request.method === 'GET' && pathname === '/') {
    const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(await forecasting.milestoneForecastView({ capacityOpen })) }
  }
  if (request.method === 'GET' && pathname === '/how-it-works') {
    return { kind: 'html', status: 200, html: renderHowItWorksScreen(await forecasting.howItWorksView()) }
  }
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) return inputsWithStep(routing)
  const setup = (await forecasting.connectionView()).kind === 'noConnect' ? undefined : await routeSetup(routing)
  if (setup) return setup
  const named = (await forecasting.inputsView()).milestone.name
  const submitted = await submitForm(routing)
  if (!submitted) return { kind: 'notFound' }
  return renamed(routing, named, submitted)
}

/**
 * The setup steps' requests: one kind's choices searched, the candidates asked for, and the posts of the query steps,
 * the Connect step, skipping periods, setup's own forms and Read again. None for any other request.
 */
function routeSetup(routing: Routing): Promise<Reply> | undefined {
  const { request, pathname } = routing
  const searchedFor = request.method === 'GET' ? STEP_SECTIONS.find((section) => section.searchedChoicesPath === pathname) : undefined
  if (searchedFor) return searchedChoices(routing, searchedFor)
  if (request.method === 'GET' && pathname === CANDIDATES_PATH) return candidatesAsked(routing)
  if (request.method !== 'POST') return undefined
  const form = request.form ?? new URLSearchParams()
  const edited = STEP_FORMS.get(pathname)
  if (edited) return queryEdited(routing, edited.section, edited.read)
  const readConnect = CONNECT_FORMS.get(pathname)
  if (readConnect) return connected(routing, readConnect(form))
  const readSkip = SKIP_FORMS.get(pathname)
  if (readSkip) return skipped(routing, readSkip(form))
  const readSetupEdit = SETUP_FORMS.get(pathname)
  if (readSetupEdit) return setupSubmitted(routing, readSetupEdit(form))
  if (pathname === SETUP_PATHS.readAgain) return readAgain(routing)
  return undefined
}

/**
 * What a post of an Inputs or Milestone forecast form is answered with: a redirect to the next screen, the Milestone
 * forecast screen refused, or the Inputs screen's view to show (`inputs`), refused or saved in place, which the caller
 * shows beside the setup steps. None for any other request.
 */
type FormReply = Reply | { kind: 'inputs'; status: number; view: InputsView }

async function submitForm({ forecasting, request, pathname, searchParams }: Routing): Promise<FormReply | undefined> {
  const readForm = request.method === 'POST' ? (INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)) : undefined
  if (!readForm) return undefined
  // the Capacity section's open state travels in the URL, and its forms carry it
  const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
  const submitted = await forecasting.submitInputs(readForm(request.form ?? new URLSearchParams()), { capacityOpen })
  // a form from the open Capacity section goes back to the screen with it open
  const pathOf = (screen: NextScreen): string => (screen === 'forecast' && capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen])
  if (!submitted.saved) {
    if (submitted.screen === 'inputs') return { kind: 'inputs', status: 400, view: submitted.view }
    return { kind: 'html', status: 400, html: renderMilestoneForecastScreen(submitted.view), path: pathOf(submitted.screen) }
  }
  if (request.saveInPlace) return { kind: 'inputs', status: 200, view: await forecasting.inputsView() }
  return { kind: 'redirect', location: pathOf(submitted.next) }
}

/**
 * An Inputs or Milestone forecast form's reply, once a milestone renamed from `named` has moved the milestone query
 * to the new name where it follows it (`followRenamedMilestone`). A milestone not yet entered has no name.
 */
async function renamed(routing: Routing, named: string, submitted: FormReply): Promise<Reply> {
  const { forecasting, request } = routing
  const now = (await forecasting.inputsView()).milestone.name
  if (named !== '' && now !== '' && named !== now) await forecasting.followRenamedMilestone({ from: named, to: now })
  if (submitted.kind !== 'inputs') return submitted
  // a save in place replaces only the sections saved, not the Milestone step, so its choices aren't asked for
  return inputsWithStep(routing, { status: submitted.status, view: submitted.view, unlisted: request.saveInPlace === true })
}

/**
 * How the Inputs screen opens its query steps, beyond what the request asks: `unlisted`, every step asks the tracker
 * nothing (a save in place, which doesn't replace them); `refused`, the step whose query was just refused opens on
 * that refusal.
 */
interface StepsOpening {
  unlisted?: boolean
  refused?: { section: StepSection; query: RefusedQuery }
}

/**
 * The Inputs screen, with the Connect step (`connection`: as connected unless given) and the query steps (the
 * Milestone step and the Comparable work step), each opening as the request asks, or as `unlisted` or `refused` say;
 * served at `/inputs`, with `status` (200 unless given). `view` is the Inputs view to show, as saved unless given. The
 * browser build has no steps.
 */
async function inputsWithStep(
  { forecasting, request, searchParams }: Routing,
  { status = 200, view, connection, unlisted = false, refused }: { status?: number; view?: InputsView; connection?: ConnectionView } & StepsOpening = {},
): Promise<Reply> {
  // the Connect step's view is given only as a connect was refused
  const opening = {
    asked: searchParams.get(STEP_FIELD),
    ...(refused && { refused: refused.section.setupStep }),
    ...(connection && { refused: 'connect' as const }),
  }
  const setup = await forecasting.openSetup(opening)
  const steps: ShownStep[] = []
  // only the step shown is built, so the tracker is asked nothing once setup is closed
  for (const section of STEP_SECTIONS.filter(({ setupStep }) => setup.kind === 'steps' && setup.step === setupStep)) {
    const editing = searchParams.get(section.editing.name) === section.editing.value
    const opening: QueryStepOpening =
      refused?.section === section
        ? { refused: refused.query }
        : {
            editing,
            confirmingBack: editing && searchParams.get(CONFIRMING_BACK.name) === CONFIRMING_BACK.value,
            unlisted,
            opened: searchParams.getAll(OPEN_FIELD),
          }
    const view = await forecasting.queryStepView(searchParams.get(section.findField) ?? '', opening, section.stepQuery)
    const candidates = view.kind === 'comparableWorkStep' && view.candidates
    steps.push({ section, view, ...(candidates && { openingId: keepOpening(candidates.opening) }) })
  }
  const html = renderInputsScreen(view ?? (await forecasting.inputsView()), connection ?? (await forecasting.connectionView()), steps, setup)
  return { kind: 'html', status, html, ...(request.method === 'POST' && { path: SCREEN_PATHS.inputs }) }
}

/**
 * "Use these", Change, Cancel, skipping connecting or a source chosen at Check: back to the Inputs screen, at the step
 * setup goes on to (`submitSetup`), made or refused. Not found for a form Check never sends.
 */
async function setupSubmitted({ forecasting }: Routing, edit: SetupEdit | undefined): Promise<Reply> {
  if (!edit) return { kind: 'notFound' }
  const { next } = await forecasting.submitSetup(edit)
  return { kind: 'redirect', location: next ? SETUP_STEP_PATHS[next] : SCREEN_PATHS.inputs }
}

/** Read again: back to the Inputs screen, read or failed, its summary saying why a read failed, the saved read in use. */
async function readAgain({ forecasting }: Routing): Promise<Reply> {
  await forecasting.submitReadAgain()
  return { kind: 'redirect', location: SCREEN_PATHS.inputs }
}

/** The candidates the Comparable work step's script asks for, in the opening it names: the candidates block alone. */
async function candidatesAsked({ forecasting, searchParams }: Routing): Promise<Reply> {
  const choices = choicesAsked(searchParams, choiceKindOf)
  if (!choices) return { kind: 'notFound' }
  const opening = await openingKept(searchParams.get(OPENING_FIELD) ?? '', () => forecasting.openCandidates())
  const candidates = await opening.read(choices)
  return { kind: 'html', status: 200, html: candidatesHtml(candidates, searchParams.get(OPENING_FIELD) ?? '', COMPARABLE_WORK_STEP) }
}

/** One kind's choices searched in the tracker, as a query step's script asks for them: that kind's list alone. */
async function searchedChoices({ forecasting, searchParams }: Routing, section: StepSection): Promise<Reply> {
  const kind = choiceKindOf(searchParams.get(KIND_FIELD) ?? '')
  const list = kind && (await forecasting.searchedChoiceList(kind, searchParams.get(section.findField) ?? '', section.stepQuery))
  return list ? { kind: 'html', status: 200, html: choiceListHtml(list, section) } : { kind: 'notFound' }
}

/**
 * A change of a step's query (`section`'s): read again, then back to the step, still open for editing after a hand
 * edit, finding otherwise. A refused hand edit shows the Inputs screen again with why and the query as typed; a
 * change of the picks the tracker rejects, the step still finding, with why beside the chips that worked; going back
 * to finding from a query it would clear asks the EM to confirm that first.
 */
async function queryEdited(routing: Routing, section: StepSection, readQueryEdit: (body: URLSearchParams) => StepQueryEdit | undefined): Promise<Reply> {
  const edit = readQueryEdit(routing.request.form ?? new URLSearchParams())
  if (!edit) return { kind: 'notFound' }
  // read at once, into setup's draft while setup is open
  const submitted = await routing.forecasting.submitStepQuery(edit, section.stepQuery)
  if (submitted.kind === 'refused') return inputsWithStep(routing, { status: 400, refused: { section, query: submitted } })
  if (submitted.kind === 'confirmClear') return { kind: 'redirect', location: section.urls.confirmingBack }
  // a query edited by hand stays open for editing; every other change goes back to finding
  return { kind: 'redirect', location: edit.kind === 'editQuery' ? section.urls.editing : section.urls.finding }
}

/**
 * The tracker's periods skipped, or counted again, which may read the tracker further back; then back to its pace.
 * Refused, the Inputs screen again, saying why.
 */
async function skipped(routing: Routing, edit: SkipEdit): Promise<Reply> {
  const submitted = await routing.forecasting.submitSkip(edit)
  if (!submitted.saved) return inputsWithStep(routing, { status: 400, ...(submitted.screen === 'inputs' && { view: submitted.view }) })
  return { kind: 'redirect', location: PACE_TRACKER_PATH }
}

/** A connect: on to the next setup step once saved; refused, the Inputs screen again with why, and the form as typed but for the token. */
async function connected(routing: Routing, edit: ConnectionEdit): Promise<Reply> {
  const submitted = await routing.forecasting.submitConnection(edit)
  if (submitted.saved) return { kind: 'redirect', location: SETUP_STEP_PATHS[submitted.next] }
  return inputsWithStep(routing, { status: 400, connection: submitted.view })
}

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
