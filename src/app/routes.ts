import { choiceKindOf } from '../connectors/connector.js'
import { connectionView, submitConnection, type Connecting, type ConnectionEdit, type ConnectionView, type SetupStep } from '../forecast/connection.js'
import { howItWorksView } from '../forecast/howItWorksView.js'
import { milestoneStepView, searchedChoiceList, submitMilestoneQuery, type MilestoneQueryEdit, type MilestoneStepOpening } from '../forecast/milestoneStep.js'
import { inputsView, submitInputs, type InputsView, type NextScreen } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from '../forecast/settings.js'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'
import { CONNECT_FORMS } from './connectSection.js'
import { renderHowItWorksScreen } from './howItWorksScreen.js'
import { INPUTS_FORMS, renderInputsScreen } from './inputsScreen.js'
import { CAPACITY_OPEN, CAPACITY_OPEN_PATH, FORECAST_FORMS, renderMilestoneForecastScreen } from './milestoneForecastScreen.js'
import { choiceListHtml, CONFIRMING_BACK, EDITING, FIND_FIELD, KIND_FIELD, MILESTONE_STEP_FORMS, MILESTONE_STEP_ID, MILESTONE_STEP_URLS, SEARCHED_CHOICES_PATH } from './milestoneStepSection.js'

/** A request as the routes see it: the server has already read the form body. */
export interface Request {
  method: string
  /** With any query: `/?capacity=open` is the Milestone forecast with its Capacity section open. */
  path: string
  /** The submitted form, for a POST. */
  form?: URLSearchParams
  /** Asked by the Inputs screen's script, which saves each input as it changes: answer a save with the Inputs screen. */
  saveInPlace?: boolean
}

/** What to send back. */
export type Reply =
  /** A screen; for a post, `path` is where the screen it answers with is served. */
  | { kind: 'html'; status: number; html: string; path?: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'notFound' }

export interface AppContext {
  storage: Storage
  /** Today's ISO calendar date: the start date's default, and what marks dates as past. */
  today: () => string
  /** What the local server build connects a tracker with; the browser build has none, so no Connect or Milestone step. */
  connecting?: Connecting
  /** The UTC instant now, which a read is made at. */
  now: () => string
}

/**
 * The context the routes run in, on `storage`; today is the system clock's local date unless given. Given
 * `connecting`, the Inputs screen has its Connect step.
 */
export function appContext(storage: Storage, today?: () => string, connecting?: Connecting, now?: () => string): AppContext {
  addDefaultTeamIfEmpty(storage)
  return {
    storage,
    today: today ?? (() => localCalendarDate(new Date())),
    now: now ?? (() => new Date().toISOString()),
    ...(connecting && { connecting }),
  }
}

/**
 * The one team everything is stored under, added on first launch and installed at `installedAt`. The MVP has no team
 * screen, so the EM never sees it: its facts are the ones the EM types in, read from no board or repository.
 */
export function defaultTeam(installedAt: string): Team {
  return { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt }
}

/** On first launch (nothing stored yet), adds the default team, installed now. Otherwise does nothing. */
function addDefaultTeamIfEmpty(storage: Storage): void {
  if (!storage.isEmpty()) return
  storage.saveTeam(defaultTeam(new Date().toISOString()))
}

/** `at` as the EM's calendar date, `YYYY-MM-DD`, in the machine's time zone: not UTC's, which can be a day off. */
function localCalendarDate(at: Date): string {
  const two = (value: number): string => String(value).padStart(2, '0')
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

/** What every route reads first: the settings, and the path asked for. */
interface Routing {
  settings: ForecastSettings
  pathname: string
  searchParams: URLSearchParams
}

function routing(request: Request): Routing {
  const { pathname, searchParams } = new URL(request.path, 'http://app')
  return { settings: DEFAULT_SETTINGS, pathname, searchParams }
}

/** A request's routing once the one team is added. */
type TeamRouting = Routing & { team: Team }

/** The Milestone forecast screen at `/`, the Inputs screen at `/inputs` and How it works at `/how-it-works`; not found for everything else. */
export function route(request: Request, context: AppContext): Reply {
  const { storage, today, connecting } = context
  const routed = routing(request)
  const { settings, pathname, searchParams } = routed
  const team = storage.teams()[0]
  if (request.method === 'GET' && pathname === '/') {
    const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
    const view: MilestoneForecastView = team ? milestoneForecastView(storage, team.id, settings, today(), { capacityOpen }) : { kind: 'empty' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (request.method === 'GET' && pathname === '/how-it-works') {
    return { kind: 'html', status: 200, html: renderHowItWorksScreen(howItWorksView(settings)) }
  }
  if (!team) return { kind: 'notFound' }
  const connection = connectionView(connecting, team.id)
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) {
    return { kind: 'html', status: 200, html: renderInputsScreen(inputsView(storage, team.id, settings, today()), connection) }
  }
  const submitted = submitForm(request, context, { ...routed, team })
  if (submitted?.kind !== 'inputs') return submitted ?? { kind: 'notFound' }
  return { kind: 'html', status: submitted.status, html: renderInputsScreen(submitted.view, connection), path: SCREEN_PATHS.inputs }
}

/**
 * What a post of an Inputs or Milestone forecast form is answered with: a redirect to the next screen, the Milestone
 * forecast screen refused, or the Inputs screen's view to show (`inputs`), refused or saved in place, which the caller
 * shows beside the setup steps it has. None for any other request.
 */
type FormReply = Reply | { kind: 'inputs'; status: number; view: InputsView }

function submitForm(request: Request, { storage, today }: AppContext, { team, settings, pathname, searchParams }: TeamRouting): FormReply | undefined {
  const readForm = request.method === 'POST' ? (INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)) : undefined
  if (!readForm) return undefined
  // the Capacity section's open state travels in the URL, and its forms carry it
  const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
  const submitted = submitInputs(storage, team.id, settings, today(), readForm(request.form ?? new URLSearchParams()), { capacityOpen })
  // a form from the open Capacity section goes back to the screen with it open
  const pathOf = (screen: NextScreen): string => (screen === 'forecast' && capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen])
  if (!submitted.saved) {
    if (submitted.screen === 'inputs') return { kind: 'inputs', status: 400, view: submitted.view }
    return { kind: 'html', status: 400, html: renderMilestoneForecastScreen(submitted.view), path: pathOf(submitted.screen) }
  }
  if (request.saveInPlace) return { kind: 'inputs', status: 200, view: inputsView(storage, team.id, settings, today()) }
  return { kind: 'redirect', location: pathOf(submitted.next) }
}

/**
 * The setup steps' requests, in the local server build: the Inputs screen, whose Milestone step asks the tracker for
 * its choices as it opens, and the Connect and Milestone steps' posts, each answered once the tracker has been asked,
 * so later than every other route; and the Inputs screen's own posts, so that the screen they answer with has the
 * Milestone step too. None for any other request, nor in the browser build, which has nothing to connect with.
 */
export function routeSetup(request: Request, context: AppContext): Promise<Reply> | undefined {
  const { connecting, storage } = context
  const team = storage.teams()[0]
  if (!connecting || !team) return undefined
  const setup: SetupRouting = { ...routing(request), team, request, context, connecting }
  const { pathname } = setup
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) return inputsWithStep(setup)
  if (request.method === 'GET' && pathname === SEARCHED_CHOICES_PATH) return searchedChoices(setup)
  const readQueryEdit = request.method === 'POST' ? MILESTONE_STEP_FORMS.get(pathname) : undefined
  if (readQueryEdit) return queryEdited(setup, readQueryEdit)
  const readConnect = request.method === 'POST' ? CONNECT_FORMS.get(pathname) : undefined
  if (readConnect) return connected(setup, readConnect)
  const submitted = submitForm(request, context, setup)
  if (submitted?.kind !== 'inputs') return undefined
  // a save in place replaces only the sections saved, not the Milestone step, so its choices aren't asked for
  return inputsWithStep(setup, { status: submitted.status, view: submitted.view, opening: { unlisted: request.saveInPlace === true } })
}

/** A setup step's request, in the local server build, with what it connects with. */
interface SetupRouting extends TeamRouting {
  request: Request
  context: AppContext
  connecting: Connecting
}

/**
 * The Inputs screen, with the Connect step (`connection`: as connected unless given) and the Milestone step, opening
 * as the request asks unless `opening` is given; served at `/inputs`, with `status` (200 unless given). `view` is the
 * Inputs view to show, as saved unless given.
 */
async function inputsWithStep(
  { request, context, connecting, team, settings, searchParams }: SetupRouting,
  { status = 200, view, connection, opening }: { status?: number; view?: InputsView; connection?: ConnectionView; opening?: MilestoneStepOpening } = {},
): Promise<Reply> {
  const asked: MilestoneStepOpening = {
    editing: searchParams.get(EDITING.name) === EDITING.value,
    confirmingBack: searchParams.get(CONFIRMING_BACK.name) === CONFIRMING_BACK.value,
  }
  const step = await milestoneStepView(connecting, team.id, searchParams.get(FIND_FIELD) ?? '', opening ?? asked)
  const html = renderInputsScreen(
    view ?? inputsView(context.storage, team.id, settings, context.today()),
    connection ?? connectionView(connecting, team.id),
    step,
  )
  return { kind: 'html', status, html, ...(request.method === 'POST' && { path: SCREEN_PATHS.inputs }) }
}

/** One kind's choices searched in the tracker, as the Milestone step's script asks for them: that kind's list alone. */
async function searchedChoices({ connecting, team, searchParams }: SetupRouting): Promise<Reply> {
  const kind = choiceKindOf(searchParams.get(KIND_FIELD) ?? '')
  const list = kind && (await searchedChoiceList(connecting, team.id, kind, searchParams.get(FIND_FIELD) ?? ''))
  return list ? { kind: 'html', status: 200, html: choiceListHtml(list) } : { kind: 'notFound' }
}

/**
 * A change of the milestone query: read again, then back to the Milestone step, still open for editing after a hand
 * edit, finding otherwise. A refused hand edit shows the Inputs screen again with why and the query as typed; going
 * back to finding from a query it would clear asks the EM to confirm that first.
 */
async function queryEdited(setup: SetupRouting, readQueryEdit: (body: URLSearchParams) => MilestoneQueryEdit | undefined): Promise<Reply> {
  const edit = readQueryEdit(setup.request.form ?? new URLSearchParams())
  if (!edit) return { kind: 'notFound' }
  const submitted = await submitMilestoneQuery(setup.connecting, setup.team.id, edit, setup.context.now())
  if (submitted.kind === 'refused') return inputsWithStep(setup, { status: 400, opening: { refused: submitted } })
  if (submitted.kind === 'confirmClear') return { kind: 'redirect', location: MILESTONE_STEP_URLS.confirmingBack }
  // a query edited by hand stays open for editing; every other change goes back to finding
  return { kind: 'redirect', location: edit.kind === 'editQuery' ? MILESTONE_STEP_URLS.editing : MILESTONE_STEP_URLS.finding }
}

/** A connect: on to the next setup step once saved; refused, the Inputs screen again with why, and the form as typed but for the token. */
async function connected(setup: SetupRouting, readConnect: (body: URLSearchParams) => ConnectionEdit): Promise<Reply> {
  const submitted = await submitConnection(setup.connecting, setup.team.id, readConnect(setup.request.form ?? new URLSearchParams()))
  if (submitted.saved) return { kind: 'redirect', location: SETUP_STEP_PATHS[submitted.next] }
  return inputsWithStep(setup, { status: 400, connection: submitted.view })
}

/** Where each setup step is served. */
const SETUP_STEP_PATHS: Record<SetupStep, string> = { connect: '/inputs#connect', milestone: MILESTONE_STEP_URLS.finding }

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
