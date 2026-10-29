import { editInputs, inputsView, type InputsEdit } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Storage } from '../storage/storage.js'
import {
  parseCadenceForm,
  parseGrowthForm,
  parseMilestoneForm,
  parsePaceForm,
  renderInputsScreen,
  savedCadenceForm,
  savedGrowthForm,
  savedMilestoneForm,
  savedPaceForm,
  type CadenceForm,
  type GrowthForm,
  type MilestoneForm,
  type PaceForm,
} from './inputsScreen.js'
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
  /** Today's ISO calendar date: the start date's default. */
  today: () => string
}

/** The Milestone forecast screen at `/` and the Inputs screen at `/inputs`; not found for everything else. */
export function route(request: Request, { storage, today }: AppContext): Reply {
  const team = storage.teams()[0]
  if (request.method === 'GET' && request.path === '/') {
    const view: MilestoneForecastView = team ? milestoneForecastView(storage, team.id, DEFAULT_SETTINGS) : { kind: 'empty' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (!team) return { kind: 'notFound' }
  const form = request.form ?? new URLSearchParams()
  // a saved POST redirects, so only a GET or a refused edit reads the Inputs view
  const inputsScreen = (
    status: number,
    refused: {
      milestoneForm?: MilestoneForm
      cadenceForm?: CadenceForm
      paceForm?: PaceForm
      growthForm?: GrowthForm
    } = {},
  ): Reply => {
    const view = inputsView(storage, team.id, today())
    return {
      kind: 'html',
      status,
      html: renderInputsScreen({
        milestone: view.milestone,
        milestoneForm: refused.milestoneForm ?? savedMilestoneForm(view.milestone),
        cadenceForm: refused.cadenceForm ?? savedCadenceForm(view.milestone),
        paceForm: refused.paceForm ?? savedPaceForm(view.milestone),
        growth: refused.growthForm ?? savedGrowthForm(view.growth),
      }),
    }
  }
  /** Saves the edit and redirects, or shows the Inputs screen again with the refusal. */
  const edit = (change: InputsEdit, location: string, refused: (error: string) => Parameters<typeof inputsScreen>[1]): Reply => {
    const saved = editInputs(storage, team.id, change)
    return saved.ok ? { kind: 'redirect', location } : inputsScreen(400, refused(saved.error))
  }

  if (request.method === 'GET' && request.path === '/inputs') return inputsScreen(200)
  if (request.method === 'POST' && request.path === '/inputs/milestone') {
    const typed = parseMilestoneForm(form)
    return edit({ kind: 'setMilestone', ...typed }, '/inputs', (error) => ({ milestoneForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/cadence') {
    const typed = parseCadenceForm(form)
    return edit({ kind: 'setCadence', ...typed }, '/inputs', (error) => ({ cadenceForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/pace') {
    const typed = parsePaceForm(form)
    return edit({ kind: 'setPaceRange', ...typed }, '/', (error) => ({ paceForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/growth') {
    const typed = parseGrowthForm(form)
    return edit({ kind: 'setAmbiguityRanges', ...typed.ranges }, '/inputs', (error) => ({ growthForm: { ...typed, error } }))
  }
  return { kind: 'notFound' }
}
