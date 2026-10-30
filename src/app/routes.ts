import { inputsView, submitInputs, type NextScreen } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Storage } from '../storage/storage.js'
import { INPUTS_FORMS, renderInputsScreen } from './inputsScreen.js'
import { renderMilestoneForecastScreen } from './milestoneForecastScreen.js'

/** A request as the routes see it: the server has already read the form body. */
export interface Request {
  method: string
  path: string
  /** The submitted form, for a POST. */
  form?: URLSearchParams
  /** Asked by the Inputs screen's script, which saves each input as it changes: answer a save with the Inputs screen. */
  saveInPlace?: boolean
}

/** What to send back. */
export type Reply =
  | { kind: 'html'; status: number; html: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'notFound' }

export interface AppContext {
  storage: Storage
  /** Today's ISO calendar date: the start date's default, and what marks dates as past. */
  today: () => string
}

/** The Milestone forecast screen at `/` and the Inputs screen at `/inputs`; not found for everything else. */
export function route(request: Request, { storage, today }: AppContext): Reply {
  const team = storage.teams()[0]
  const settings = DEFAULT_SETTINGS
  if (request.method === 'GET' && request.path === '/') {
    const view: MilestoneForecastView = team ? milestoneForecastView(storage, team.id, settings, today()) : { kind: 'empty' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (!team) return { kind: 'notFound' }
  const inputsScreen = (): Reply => ({ kind: 'html', status: 200, html: renderInputsScreen(inputsView(storage, team.id, settings, today())) })
  if (request.method === 'GET' && request.path === '/inputs') return inputsScreen()
  const readForm = request.method === 'POST' ? INPUTS_FORMS.get(request.path) : undefined
  if (!readForm) return { kind: 'notFound' }
  const submitted = submitInputs(storage, team.id, settings, today(), readForm(request.form ?? new URLSearchParams()))
  if (!submitted.saved) return { kind: 'html', status: 400, html: renderInputsScreen(submitted.screen) }
  return request.saveInPlace ? inputsScreen() : { kind: 'redirect', location: SCREEN_PATHS[submitted.next] }
}

/** Where each screen is served. */
const SCREEN_PATHS: Record<NextScreen, string> = { forecast: '/', inputs: '/inputs' }
