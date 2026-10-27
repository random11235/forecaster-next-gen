import { editInputs, inputsView, type InputsEdit } from '../forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Storage } from '../storage/storage.js'
import {
  parseDetailsForm,
  parseEpicForm,
  parseGrowthForm,
  parseMilestoneForm,
  parsePaceForm,
  parseWorkflowForm,
  renderInputsScreen,
  savedGrowthForm,
  savedPaceForm,
  savedWorkflowForm,
  type GrowthScreen,
  type InputsScreen,
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
  /** Today's ISO calendar date, the day forecasts start from. */
  today: () => string
  /** The ISO timestamp now, when the EM's edits are made. */
  now: () => string
}

/** The Milestone forecast screen at `/` and the Inputs screen at `/inputs`; not found for everything else. */
export function route(request: Request, { storage, today, now }: AppContext): Reply {
  // the settings aren't editable yet; both screens read the same ones
  const settings = DEFAULT_SETTINGS
  const team = storage.teams()[0]
  if (request.method === 'GET' && request.path === '/') {
    const view: MilestoneForecastView = team
      ? milestoneForecastView(storage, team.id, { today: today(), settings })
      : { kind: 'noMilestone' }
    return { kind: 'html', status: 200, html: renderMilestoneForecastScreen(view) }
  }
  if (!team) return { kind: 'notFound' }
  const form = request.form ?? new URLSearchParams()
  // a saved POST redirects, so only a GET or a refused edit reads the Inputs view
  const inputsScreen = (
    status: number,
    {
      pace,
      workflowForm,
      growthForm,
      ...screen
    }: Partial<Omit<InputsScreen, 'milestone' | 'workflow' | 'growth'>> & {
      workflowForm?: Omit<WorkflowScreen, 'statuses'>
      growthForm?: Partial<Omit<GrowthScreen, 'view'>>
    } = {},
  ): Reply => {
    const view = inputsView(storage, team.id, settings)
    return {
      kind: 'html',
      status,
      html: renderInputsScreen({
        milestone: view.milestone,
        // with no milestone there is no pace form, even to show a refused pace in
        pace: view.milestone.kind === 'milestone' ? (pace ?? savedPaceForm(view.pace)) : undefined,
        growth: { view: view.growth, form: savedGrowthForm(view.growth), ...growthForm },
        workflow: { statuses: view.workflow.statuses.map((entry) => entry.status), ...(workflowForm ?? { form: savedWorkflowForm(view.workflow) }) },
        ...screen,
      }),
    }
  }
  /** Saves the edit and redirects, or shows the Inputs screen again with the refusal. */
  const edit = (change: InputsEdit, location: string, refused: (error: string) => Parameters<typeof inputsScreen>[1]): Reply => {
    const saved = editInputs(storage, team.id, change, settings)
    return saved.ok ? { kind: 'redirect', location } : inputsScreen(400, refused(saved.error))
  }

  if (request.method === 'GET' && request.path === '/inputs') return inputsScreen(200)
  if (request.method === 'POST' && request.path === '/inputs') {
    const typed = parsePaceForm(form)
    return edit({ kind: 'setPace', ...typed }, '/', (error) => ({ pace: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/milestone') {
    const typed = parseMilestoneForm(form)
    const { name, committedDate } = typed.form
    return edit({ kind: 'create', name, committedDate, epics: typed.epics }, '/inputs', (error) => ({ milestoneForm: { ...typed.form, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/milestone/details') {
    const typed = parseDetailsForm(form)
    return edit({ kind: 'editDetails', ...typed }, '/inputs', (error) => ({ detailsForm: { ...typed, error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/epics') {
    const change = parseEpicForm(form, now())
    if (!change.ok) return inputsScreen(400, { epicsError: change.error })
    return edit(change.edit, '/inputs', (error) => ({ epicsError: error }))
  }
  if (request.method === 'POST' && request.path === '/inputs/growth') {
    const typed = parseGrowthForm(form)
    return edit({ kind: 'setAmbiguityRanges', ...typed.ranges }, '/inputs', (error) => ({ growthForm: { form: { ...typed, error } } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/growth/medium') {
    const change: InputsEdit = form.get('source') === 'measured' ? { kind: 'useMeasuredMedium' } : { kind: 'useMediumRange' }
    return edit(change, '/inputs', (error) => ({ growthForm: { mediumError: error } }))
  }
  if (request.method === 'POST' && request.path === '/inputs/workflow') {
    const typed = parseWorkflowForm(form)
    return edit({ kind: 'editWorkflow', ...typed.edit }, '/inputs', (error) => ({ workflowForm: { form: typed.form, error } }))
  }
  return { kind: 'notFound' }
}
