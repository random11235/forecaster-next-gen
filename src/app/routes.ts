import { milestoneForecastView, type MilestoneForecastView } from '../forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../forecast/settings.js'
import type { Storage } from '../storage/storage.js'
import { editMilestone, milestoneDefinitionView, parseEpicForm, teamMilestone } from '../forecast/milestoneDefinition.js'
import { teamFacts } from '../forecast/teamFacts.js'
import { editWorkflowSettings, workflowSettingsView } from '../forecast/workflowSettings.js'
import {
  parseDetailsForm,
  parseMilestoneForm,
  parsePaceForm,
  parseWorkflowForm,
  renderInputsScreen,
  savedWorkflowForm,
  type InputsScreen,
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
  if (!team) return { kind: 'notFound' }
  // v1 is single-team: the inputs are for its milestone
  const milestone = teamMilestone(storage, team.id)
  const form = request.form ?? new URLSearchParams()
  // the team's facts are read only to render the screen, so a saved POST that redirects doesn't read them here
  const inputsScreen = (
    status: number,
    { workflowForm, ...screen }: Partial<Omit<InputsScreen, 'workflow'>> & { workflowForm?: Omit<WorkflowScreen, 'statuses'> } = {},
  ): Reply => {
    const facts = teamFacts(storage, team.id)
    const workflow = workflowSettingsView(facts)
    return {
      kind: 'html',
      status,
      html: renderInputsScreen({
        milestone: milestoneDefinitionView(storage, team.id, facts),
        pace: milestone && savedPaceForm(storage, milestone.teamId, milestone.id),
        workflow: { statuses: workflow.statuses.map((entry) => entry.status), ...(workflowForm ?? { form: savedWorkflowForm(workflow) }) },
        ...screen,
      }),
    }
  }

  if (request.method === 'GET' && request.path === '/inputs') return inputsScreen(200)
  if (request.method === 'POST' && request.path === '/inputs' && milestone) {
    const pace = parsePaceForm(form)
    if (!pace.ok) return inputsScreen(400, { pace: pace.form })
    storage.savePaceSetting({ teamId: milestone.teamId, milestoneId: milestone.id, mode: 'manual', ...pace.range })
    return { kind: 'redirect', location: '/' }
  }
  if (request.method === 'POST' && request.path === '/inputs/milestone') {
    const typed = parseMilestoneForm(form)
    const saved = editMilestone(storage, team.id, { kind: 'create', name: typed.form.name, committedDate: typed.form.committedDate, epics: typed.epics })
    if (!saved.ok) return inputsScreen(400, { milestoneForm: { ...typed.form, error: saved.error } })
    return { kind: 'redirect', location: '/inputs' }
  }
  if (request.method === 'POST' && request.path === '/inputs/milestone/details') {
    const typed = parseDetailsForm(form)
    const saved = editMilestone(storage, team.id, { kind: 'editDetails', ...typed })
    if (!saved.ok) return inputsScreen(400, { detailsForm: { ...typed, error: saved.error } })
    return { kind: 'redirect', location: '/inputs' }
  }
  if (request.method === 'POST' && request.path === '/inputs/epics') {
    const change = parseEpicForm(form)
    const saved = change.ok ? editMilestone(storage, team.id, change.edit) : change
    if (!saved.ok) return inputsScreen(400, { epicsError: saved.error })
    return { kind: 'redirect', location: '/inputs' }
  }
  if (request.method === 'POST' && request.path === '/inputs/workflow') {
    const typed = parseWorkflowForm(form)
    const saved = editWorkflowSettings(storage, team.id, typed.edit)
    if (!saved.ok) return inputsScreen(400, { workflowForm: { form: typed.form, error: saved.error } })
    return { kind: 'redirect', location: '/inputs' }
  }
  return { kind: 'notFound' }
}

/** The pace form filled with the saved manual range, or empty. */
function savedPaceForm(storage: Storage, teamId: string, milestoneId: string): PaceForm {
  const saved = storage.paceSetting(teamId, milestoneId)
  return saved?.mode === 'manual' ? { low: String(saved.low), high: String(saved.high) } : { low: '', high: '' }
}
