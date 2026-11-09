import { howItWorksView } from '../forecast/howItWorksView.js'
import { inputsView, submitInputs, type NextScreen, type RefusedScreen } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Team } from '../model/team.js'
import type { Storage } from '../storage/storage.js'
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
}

/** The context the routes run in, on `storage`; today is the system clock's local date unless given. */
export function appContext(storage: Storage, today?: () => string): AppContext {
  addDefaultTeamIfEmpty(storage)
  return { storage, today: today ?? (() => localCalendarDate(new Date())) }
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

/** The Milestone forecast screen at `/`, the Inputs screen at `/inputs` and How it works at `/how-it-works`; not found for everything else. */
export function route(request: Request, { storage, today }: AppContext): Reply {
  const team = storage.teams()[0]
  const settings = DEFAULT_SETTINGS
  const { pathname, searchParams } = new URL(request.path, 'http://app')
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
  const inputsScreen = (): Reply & { kind: 'html' } => ({
    kind: 'html',
    status: 200,
    html: renderInputsScreen(inputsView(storage, team.id, settings, today())),
  })
  if (request.method === 'GET' && pathname === '/inputs') return inputsScreen()
  const readForm = request.method === 'POST' ? (INPUTS_FORMS.get(pathname) ?? FORECAST_FORMS.get(pathname)) : undefined
  if (!readForm) return { kind: 'notFound' }
  const submitted = submitInputs(storage, team.id, settings, today(), readForm(request.form ?? new URLSearchParams()), { capacityOpen })
  // a form from the open Capacity section goes back to the screen with it open
  const pathOf = (screen: NextScreen): string => (screen === 'forecast' && capacityOpen ? CAPACITY_OPEN_PATH : SCREEN_PATHS[screen])
  if (!submitted.saved) return { kind: 'html', status: 400, html: renderRefused(submitted), path: pathOf(submitted.screen) }
  return request.saveInPlace ? { ...inputsScreen(), path: SCREEN_PATHS.inputs } : { kind: 'redirect', location: pathOf(submitted.next) }
}

/** The screen a refused form names, shown again with its refusal. */
function renderRefused(refused: RefusedScreen): string {
  return refused.screen === 'inputs' ? renderInputsScreen(refused.view) : renderMilestoneForecastScreen(refused.view)
}

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
