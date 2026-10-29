import { editInputs, inputsView, type InputsEdit } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Storage } from '../storage/storage.js'
import {
  parseGrowthForm,
  parseMilestoneForm,
  parsePaceForm,
  parseWorkflowForm,
  renderInputsScreen,
  savedGrowthForm,
  savedMilestoneForm,
  savedPaceForm,
  savedWorkflowForm,
  type GrowthForm,
  type MilestoneForm,
  type PaceForm,
  type WorkflowScreen,
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
  // the settings aren't editable yet; both screens read the same ones
  const settings = DEFAULT_SETTINGS
  const team = storage.teams()[0]
  if (request.method === 'GET' && request.path === '/') {
    const view: MilestoneForecastView = team ? milestoneForecastView(storage, team.id, settings) : { kind: 'empty' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (!team) return { kind: 'notFound' }
  const form = request.form ?? new URLSearchParams()
  // a saved POST redirects, so only a GET or a refused edit reads the Inputs view
  const inputsScreen = (
    status: number,
    refused: {
      milestoneForm?: MilestoneForm
      paceForm?: PaceForm
      workflowForm?: Omit<WorkflowScreen, 'statuses'>
      growthForm?: GrowthForm
    } = {},
  ): Reply => {
    const view = inputsView(storage, team.id, settings, today())
    return {
      kind: 'html',
      status,
      html: renderInputsScreen({
        milestone: view.forecastInputs,
        milestoneForm: refused.milestoneForm ?? savedMilestoneForm(view.forecastInputs),
        paceForm: refused.paceForm ?? savedPaceForm(view.forecastInputs),
        growth: refused.growthForm ?? savedGrowthForm(view.growth),
        workflow: { statuses: view.workflow.statuses.map((entry) => entry.status), ...(refused.workflowForm ?? { form: savedWorkflowForm(view.workflow) }) },
      }),
    }
  }
  /** Saves the edit and redirects, or shows the Inputs screen again with the refusal. */
  const edit = (change: InputsEdit, location: string, refused: (error: string) => Parameters<typeof inputsScreen>[1]): Reply => {
    const saved = editInputs(storage, team.id, change, settings, today())
    return saved.ok ? { kind: 'redirect', location } : inputsScreen(400, refused(saved.error))
  }

  if (request.method === 'GET' && request.path === '/inputs') return inputsScreen(200)
  if (request.method === 'POST' && request.path === '/inputs/milestone') {
    const typed = parseMilestoneForm(form)
    return edit({ kind: 'setMilestone', ...typed }, '/inputs', (error) => ({ milestoneForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/pace') {
    const typed = parsePaceForm(form)
    return edit({ kind: 'setPaceRange', ...typed }, '/', (error) => ({ paceForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/growth') {
    const typed = parseGrowthForm(form)
    return edit({ kind: 'setAmbiguityRanges', ...typed.ranges }, '/inputs', (error) => ({ growthForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/workflow') {
    const typed = parseWorkflowForm(form)
    return edit({ kind: 'editWorkflow', ...typed.edit }, '/inputs', (error) => ({ workflowForm: { form: typed.form, error } }))
  }
  return { kind: 'notFound' }
}
