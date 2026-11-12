import { connectionView, submitConnection, type Connecting, type ConnectionView, type SetupStep } from '../forecast/connection.js'
import { howItWorksView } from '../forecast/howItWorksView.js'
import { milestoneStepView, searchedChoiceList, submitMilestoneQuery, type MilestoneStepOpening, type MilestoneStepView } from '../forecast/milestoneStep.js'
import { inputsView, submitInputs, type NextScreen, type RefusedScreen } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from '../forecast/settings.js'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'
import { CONNECT_FORMS } from './connectSection.js'
import { renderHowItWorksScreen } from './howItWorksScreen.js'
import { INPUTS_FORMS, renderInputsScreen } from './inputsScreen.js'
import { CAPACITY_OPEN, CAPACITY_OPEN_PATH, FORECAST_FORMS, renderMilestoneForecastScreen } from './milestoneForecastScreen.js'
import { choiceListHtml, EDITING, FIND_FIELD, KIND_FIELD, MILESTONE_STEP_FORMS, MILESTONE_STEP_ID, MILESTONE_STEP_URLS, SEARCHED_CHOICES_PATH } from './milestoneStepSection.js'

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

/** What every route reads first: the one team (none before it is added), the settings, and the path asked for. */
interface Routing {
  team: Team | undefined
  settings: ForecastSettings
  pathname: string
  searchParams: URLSearchParams
  /** The Inputs screen, with the Connect step `connection` first, then any Milestone step. */
  inputsScreen: (teamId: string, connection: ConnectionView, milestoneStep?: MilestoneStepView) => string
}

function routing(request: Request, { storage, today }: AppContext): Routing {
  const settings = DEFAULT_SETTINGS
  const { pathname, searchParams } = new URL(request.path, 'http://app')
  const inputsScreen = (teamId: string, connection: ConnectionView, milestoneStep?: MilestoneStepView): string =>
    renderInputsScreen(inputsView(storage, teamId, settings, today()), connection, milestoneStep)
  return { team: storage.teams()[0], settings, pathname, searchParams, inputsScreen }
}

/** The Milestone forecast screen at `/`, the Inputs screen at `/inputs` and How it works at `/how-it-works`; not found for everything else. */
export function route(request: Request, context: AppContext): Reply {
  const { storage, today, connecting } = context
  const { team, settings, pathname, searchParams, inputsScreen } = routing(request, context)
  // the Capacity section's open state travels in the URL, and its forms carry it
  const capacityOpen = searchParams.get(CAPACITY_OPEN.name) === CAPACITY_OPEN.value
  if (request.method === 'GET' && pathname === '/') {
    const view: MilestoneForecastView = team ? milestoneForecastView(storage, team.id, settings, today(), { capacityOpen }) : { kind: 'empty' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (request.method === 'GET' && pathname === '/how-it-works') {
    return { kind: 'html', status: 200, html: renderHowItWorksScreen(howItWorksView(settings)) }
  }
  if (!team) return { kind: 'notFound' }
  const inputs = (): Reply & { kind: 'html' } => ({ kind: 'html', status: 200, html: inputsScreen(team.id, connectionView(connecting, team.id)) })
  if (request.method === 'GET' && pathname === '/inputs') return inputs()
  const readForm = request.method === 'POST' ? (INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)) : undefined
  if (!readForm) return { kind: 'notFound' }
  const submitted = submitInputs(storage, team.id, settings, today(), readForm(request.form ?? new URLSearchParams()), { capacityOpen })
  // a form from the open Capacity section goes back to the screen with it open
  const pathOf = (screen: NextScreen): string => (screen === 'forecast' && capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen])
  if (!submitted.saved) return { kind: 'html', status: 400, html: renderRefused(submitted, connectionView(connecting, team.id)), path: pathOf(submitted.screen) }
  return request.saveInPlace ? { ...inputs(), path: SCREEN_PATHS.inputs } : { kind: 'redirect', location: pathOf(submitted.next) }
}

/** The screen a refused form names, shown again with its refusal; on the Inputs screen, beside the Connect step `connection`. */
function renderRefused(refused: RefusedScreen, connection: ConnectionView): string {
  return refused.screen === 'inputs' ? renderInputsScreen(refused.view, connection) : renderMilestoneForecastScreen(refused.view)
}

/**
 * The setup steps' requests, in the local server build: the Inputs screen, whose Milestone step asks the tracker for
 * its choices as it opens, and the Connect and Milestone steps' posts, each answered once the tracker has been asked,
 * so later than every other route. None for any other request, nor in the browser build, which has nothing to connect
 * with. A refused connect shows the Inputs screen again with why, and the form as typed but for the token. A change of
 * the milestone query reads it again, then goes back to the Milestone step: still open for editing after a hand edit,
 * finding otherwise. A refused hand edit shows the Inputs screen again with why and the query as typed.
 */
export function routeSetup(request: Request, context: AppContext): Promise<Reply> | undefined {
  const { connecting, now } = context
  const { team, pathname, searchParams, inputsScreen } = routing(request, context)
  if (!connecting || !team) return undefined
  const milestoneStep = (opening: MilestoneStepOpening = { editing: searchParams.get(EDITING.name) === EDITING.value }): Promise<MilestoneStepView> =>
    milestoneStepView(connecting, team.id, searchParams.get(FIND_FIELD) ?? '', opening)
  if (request.method === 'GET' && pathname === SCREEN_PATHS.inputs) {
    return (async (): Promise<Reply> => ({ kind: 'html', status: 200, html: inputsScreen(team.id, connectionView(connecting, team.id), await milestoneStep()) }))()
  }
  if (request.method === 'GET' && pathname === SEARCHED_CHOICES_PATH) {
    return (async (): Promise<Reply> => {
      const list = await searchedChoiceList(connecting, team.id, searchParams.get(KIND_FIELD) ?? '', searchParams.get(FIND_FIELD) ?? '')
      return list ? { kind: 'html', status: 200, html: choiceListHtml(list) } : { kind: 'notFound' }
    })()
  }
  const form = request.form ?? new URLSearchParams()
  const readQueryEdit = request.method === 'POST' ? MILESTONE_STEP_FORMS.get(pathname) : undefined
  if (readQueryEdit) {
    return (async (): Promise<Reply> => {
      const edit = readQueryEdit(form)
      const submitted = await submitMilestoneQuery(connecting, team.id, edit, now())
      if (submitted.kind === 'refused') {
        const html = inputsScreen(team.id, connectionView(connecting, team.id), await milestoneStep({ refused: submitted }))
        return { kind: 'html', status: 400, html, path: SCREEN_PATHS.inputs }
      }
      // a query edited by hand stays open for editing; every other change goes back to finding
      return { kind: 'redirect', location: edit.kind === 'editQuery' ? MILESTONE_STEP_URLS.editing : MILESTONE_STEP_URLS.finding }
    })()
  }
  const readConnect = request.method === 'POST' ? CONNECT_FORMS.get(pathname) : undefined
  if (!readConnect) return undefined
  return (async (): Promise<Reply> => {
    const submitted = await submitConnection(connecting, team.id, readConnect(form))
    if (submitted.saved) return { kind: 'redirect', location: SETUP_STEP_PATHS[submitted.next] }
    return { kind: 'html', status: 400, html: inputsScreen(team.id, submitted.view, await milestoneStep()), path: SCREEN_PATHS.inputs }
  })()
}

/** Where each setup step is served. */
const SETUP_STEP_PATHS: Record<SetupStep, string> = { connect: '/inputs#connect', milestone: MILESTONE_STEP_URLS.finding }

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
