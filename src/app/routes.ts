import { connectionView, submitConnection, type Connecting, type ConnectionView, type SetupStep } from '../forecast/connection.js'
import { howItWorksView } from '../forecast/howItWorksView.js'
import { inputsView, submitInputs, type NextScreen, type RefusedScreen } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from '../forecast/settings.js'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'
import { CONNECT_FORMS } from './connectSection.js'
import { renderHowItWorksScreen } from './howItWorksScreen.js'
import { INPUTS_FORMS, renderInputsScreen } from './inputsScreen.js'
import { CAPACITY_OPEN, CAPACITY_OPEN_PATH, FORECAST_FORMS, renderMilestoneForecastScreen } from './milestoneForecastScreen.js'

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
  /** What the local server build connects a tracker with; the browser build has none, so no Connect step. */
  connecting?: Connecting
}

/**
 * The context the routes run in, on `storage`; today is the system clock's local date unless given. Given
 * `connecting`, the Inputs screen has its Connect step.
 */
export function appContext(storage: Storage, today?: () => string, connecting?: Connecting): AppContext {
  addDefaultTeamIfEmpty(storage)
  return { storage, today: today ?? (() => localCalendarDate(new Date())), ...(connecting && { connecting }) }
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
  /** The Inputs screen, with the Connect step `connection` first. */
  inputsScreen: (teamId: string, connection: ConnectionView) => string
}

function routing(request: Request, { storage, today }: AppContext): Routing {
  const settings = DEFAULT_SETTINGS
  const { pathname, searchParams } = new URL(request.path, 'http://app')
  const inputsScreen = (teamId: string, connection: ConnectionView): string =>
    renderInputsScreen(inputsView(storage, teamId, settings, today()), connection)
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
 * The Connect step's posts, in the local server build: answered once the tracker has been asked, so later than every
 * other route. None for any other request, nor in the browser build, which has nothing to connect with. Refused, the
 * Inputs screen shows again with why, and the form as typed but for the token.
 */
export function routeConnection(request: Request, context: AppContext): Promise<Reply> | undefined {
  const { connecting } = context
  const { team, pathname, inputsScreen } = routing(request, context)
  const readForm = request.method === 'POST' ? CONNECT_FORMS.get(pathname) : undefined
  if (!connecting || !team || !readForm) return undefined
  return (async (): Promise<Reply> => {
    const submitted = await submitConnection(connecting, team.id, readForm(request.form ?? new URLSearchParams()))
    if (submitted.saved) return { kind: 'redirect', location: SETUP_STEP_PATHS[submitted.next] }
    return { kind: 'html', status: 400, html: inputsScreen(team.id, submitted.view), path: SCREEN_PATHS.inputs }
  })()
}

/**
 * Where each setup step is served. Picking the milestone's tickets isn't built yet, so a good connect comes back to
 * the Connect step, connected.
 */
const SETUP_STEP_PATHS: Record<SetupStep, string> = { connect: '/inputs#connect', milestone: '/inputs#connect' }

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
