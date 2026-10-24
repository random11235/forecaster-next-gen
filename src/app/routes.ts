import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Storage } from '../storage/storage.js'
import { parsePaceForm, renderInputsScreen, type PaceForm } from './inputsScreen.js'
import { renderMilestoneForecastScreen } from './milestoneForecastScreen.js'

/** A request as the routes see it: the server has already read the form body. */
export interface Request {
  method: string
  path: string
  /** The submitted form, for a POST. */
  form?: URLSearchParams
}

/** What to send back. */
export type Reply =
  | { kind: 'html'; status: number; html: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'notFound' }

export interface AppContext {
  storage: Storage
  /** Today's ISO calendar date, the day forecasts start from. */
  today: () => string
}

/** The Milestone forecast screen at `/` and the Inputs screen at `/inputs`; not found for everything else. */
export function route(request: Request, { storage, today }: AppContext): Reply {
  const team = storage.teams()[0]
  if (request.method === 'GET' && request.path === '/') {
    const view: MilestoneForecastView = team
      ? milestoneForecastView(storage, team.id, { today: today(), settings: DEFAULT_SETTINGS })
      : { kind: 'noMilestone' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  // v1 is single-team, with one milestone: the inputs are for those
  const milestone = team && storage.milestones(team.id)[0]
  if (request.method === 'GET' && request.path === '/inputs') {
    return { kind: 'html', status: 200, html: renderInputsScreen(milestone && savedPaceForm(storage, milestone.teamId, milestone.id)) }
  }
  if (request.method === 'POST' && request.path === '/inputs' && milestone) {
    const pace = parsePaceForm(request.form ?? new URLSearchParams())
    if (!pace.ok) return { kind: 'html', status: 400, html: renderInputsScreen(pace.form) }
    storage.savePaceSetting({ teamId: milestone.teamId, milestoneId: milestone.id, mode: 'manual', ...pace.range })
    return { kind: 'redirect', location: '/' }
  }
  return { kind: 'notFound' }
}

/** The pace form filled with the saved manual range, or empty. */
function savedPaceForm(storage: Storage, teamId: string, milestoneId: string): PaceForm {
  const saved = storage.paceSetting(teamId, milestoneId)
  return saved?.mode === 'manual' ? { low: String(saved.low), high: String(saved.high) } : { low: '', high: '' }
}
