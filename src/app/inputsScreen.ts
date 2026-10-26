import { MAX_TICKETS_PER_WEEK, type InputsEdit } from '../forecast/inputs.js'
import type { EpicChoice, MilestoneDefinitionView, RankedEpic } from '../forecast/milestoneDefinition.js'
import type { WorkflowEdit, WorkflowSettingsView } from '../forecast/workflowSettings.js'
import type { ThroughputRange } from '../model/paceSetting.js'
import { STATUS_CATEGORIES, STATUS_CATEGORY_NAMES, type StatusCategory } from '../model/workflow.js'
import { commitText, escapeHtml, formatDate, htmlPage } from './html.js'

/** The pace form as typed: what the EM entered, and why it was refused, if it was. */
export interface PaceForm {
  low: string
  high: string
  error?: string
}

/** Reads the submitted pace form; the rules it must meet are checked when it is saved. */
export function parsePaceForm(body: URLSearchParams): PaceForm {
  return { low: body.get('low') ?? '', high: body.get('high') ?? '' }
}

/** The pace form filled with the saved manual range, or empty. */
export function savedPaceForm(range: ThroughputRange | undefined): PaceForm {
  return range ? { low: String(range.low), high: String(range.high) } : { low: '', high: '' }
}

/** Reads an epic change submitted from the Inputs screen at `at` (an ISO timestamp): add, remove, move up or down, or commit. */
export function parseEpicForm(body: URLSearchParams, at: string): { ok: true; edit: InputsEdit } | { ok: false; error: string } {
  const epicId = body.get('epic') ?? ''
  const action = body.get('action')
  switch (action) {
    case 'commit':
      return { ok: true, edit: { kind: 'commitEpic', epicId, at } }
    case 'add':
      return { ok: true, edit: { kind: 'addEpic', epicId } }
    case 'remove':
      return { ok: true, edit: { kind: 'removeEpic', epicId } }
    case 'up':
    case 'down':
      return { ok: true, edit: { kind: 'moveEpic', epicId, direction: action } }
    default:
      return { ok: false, error: 'Choose Add, Remove, Up, Down or Commit.' }
  }
}

/** The milestone's name and committed date as typed, and why they were refused, if they were. */
export interface DetailsForm {
  name: string
  committedDate: string
  error?: string
}

/** The new-milestone form as typed: its details, and the rank typed for each epic, by epic ID. */
export interface MilestoneForm extends DetailsForm {
  ranks: Record<string, string>
}

const RANK_FIELD = 'rank-'

/** Reads the submitted name and committed date; the rules they must meet are checked when they are saved. */
export function parseDetailsForm(body: URLSearchParams): DetailsForm {
  return { name: body.get('name') ?? '', committedDate: body.get('committedDate')?.trim() ?? '' }
}

/** Reads the submitted new-milestone form. An epic with a rank typed is chosen; one left blank is not. */
export function parseMilestoneForm(body: URLSearchParams): { form: MilestoneForm; epics: RankedEpic[] } {
  const ranks: Record<string, string> = {}
  for (const [field, value] of body) if (field.startsWith(RANK_FIELD)) ranks[field.slice(RANK_FIELD.length)] = value
  const epics = Object.entries(ranks)
    .filter(([, rank]) => rank.trim() !== '')
    .map(([epicId, rank]) => ({ epicId, rank }))
  return { form: { ...parseDetailsForm(body), ranks }, epics }
}

/** The workflow settings form as typed: a category for each status by name, and the rest as text. */
export interface WorkflowForm {
  /** Each status's category as chosen, by status name; blank when none was chosen. */
  categories: Record<string, string>
  startedStatus: string
  /** Comma-separated lists. */
  spikeTypes: string
  spikeLabels: string
  /** Blank for none. */
  commitLabel: string
  blockedStatuses: string
  blockedLabels: string
}

const STATUS_FIELD = 'status:'
const LIST_SEPARATOR = ', '

/** Reads the submitted workflow settings form; the rules they must meet are checked when they are saved. */
export function parseWorkflowForm(body: URLSearchParams): { form: WorkflowForm; edit: WorkflowEdit } {
  const categories: Record<string, string> = {}
  for (const [field, value] of body) if (field.startsWith(STATUS_FIELD)) categories[field.slice(STATUS_FIELD.length)] = value
  const text = (field: keyof WorkflowForm): string => body.get(field) ?? ''
  const form: WorkflowForm = {
    categories,
    startedStatus: text('startedStatus'),
    spikeTypes: text('spikeTypes'),
    spikeLabels: text('spikeLabels'),
    commitLabel: text('commitLabel'),
    blockedStatuses: text('blockedStatuses'),
    blockedLabels: text('blockedLabels'),
  }
  const list = (typed: string): string[] => typed.split(',')
  const edit: WorkflowEdit = {
    categories,
    startedStatus: form.startedStatus,
    spikeRule: { types: list(form.spikeTypes), labels: list(form.spikeLabels) },
    commitLabel: form.commitLabel,
    blockedRule: { statuses: list(form.blockedStatuses), labels: list(form.blockedLabels) },
  }
  return { form, edit }
}

/** The workflow settings form filled with the team's saved settings. */
export function savedWorkflowForm({ statuses, startedStatus, spikeRule, commitLabel, blockedRule }: WorkflowSettingsView): WorkflowForm {
  return {
    categories: Object.fromEntries(statuses.map(({ status, category }) => [status, category ?? ''])),
    startedStatus,
    spikeTypes: spikeRule.types.join(LIST_SEPARATOR),
    spikeLabels: spikeRule.labels.join(LIST_SEPARATOR),
    commitLabel: commitLabel ?? '',
    blockedStatuses: blockedRule.statuses.join(LIST_SEPARATOR),
    blockedLabels: blockedRule.labels.join(LIST_SEPARATOR),
  }
}

/** The workflow section: the statuses to map, in order, and the form as saved or as typed when refused. */
export interface WorkflowScreen {
  statuses: string[]
  form: WorkflowForm
  error?: string
}

/** What the Inputs screen shows. */
export interface InputsScreen {
  milestone: MilestoneDefinitionView
  /** The new-milestone form as typed, when it was refused. */
  milestoneForm?: MilestoneForm
  /** The name and committed date as typed, when they were refused. */
  detailsForm?: DetailsForm
  /** Why an epic change was refused. */
  epicsError?: string
  /** The pace form; undefined when there is no milestone yet. */
  pace: PaceForm | undefined
  workflow: WorkflowScreen
}

/** The Inputs screen: the milestone's definition, its manual pace range and the team's workflow settings. */
export function renderInputsScreen(screen: InputsScreen): string {
  const milestone =
    screen.milestone.kind === 'milestone'
      ? epicsSection(screen.milestone, screen.detailsForm ?? screen.milestone, screen.epicsError)
      : newMilestoneSection(screen.milestone.teamEpics, screen.milestoneForm ?? { name: '', committedDate: '', ranks: {} })
  return htmlPage(
    'Inputs',
    `${milestone}\n${screen.pace ? paceSection(screen.pace) : NO_MILESTONE}\n${workflowSection(screen.workflow)}`,
  )
}

function newMilestoneSection(teamEpics: EpicChoice[], form: MilestoneForm): string {
  const epics =
    teamEpics.length === 0
      ? '          <p>The team has no epics yet.</p>'
      : teamEpics
          .map(
            (epic) =>
              `          <label class="epic"><input type="number" name="${RANK_FIELD}${escapeHtml(epic.epicId)}" min="1" max="${teamEpics.length}" step="1" value="${escapeHtml(form.ranks[epic.epicId] ?? '')}" aria-label="Rank of ${epicLabel(epic)}"> ${epicLabel(epic)}</label>`,
          )
          .join('\n')
  return `    <section aria-label="Milestone">
      <h2>Milestone</h2>
      <p>Name the milestone, give the date committed to stakeholders, and rank the epics it holds.</p>
      <form method="post" action="/inputs/milestone">${errorLine(form.error)}
${detailsFields(form)}
        <fieldset>
          <legend>Rank each epic in the milestone, 1 for the highest; leave the others blank</legend>
${epics}
        </fieldset>
        <p><button type="submit">Create milestone</button></p>
      </form>
    </section>`
}

function detailsFields(form: DetailsForm): string {
  return `        <label>Name <input type="text" name="name" value="${escapeHtml(form.name)}" required></label>
        <label>Committed date <input type="date" name="committedDate" value="${escapeHtml(form.committedDate)}" required></label>`
}

function epicsSection(
  milestone: Extract<MilestoneDefinitionView, { kind: 'milestone' }>,
  details: DetailsForm,
  error: string | undefined,
): string {
  const last = milestone.epics.length - 1
  const rows = milestone.epics
    .map(
      (epic, rank) => `        <li>
          <form method="post" action="/inputs/epics">
            <span>${epicLabel(epic)}</span>
            <input type="hidden" name="epic" value="${escapeHtml(epic.epicId)}">
            <button type="submit" name="action" value="up"${rank === 0 ? ' disabled' : ''}>Up</button>
            <button type="submit" name="action" value="down"${rank === last ? ' disabled' : ''}>Down</button>
            <button type="submit" name="action" value="remove"${last === 0 ? ' disabled' : ''}>Remove</button>
            ${epic.commit ? `<span class="note">${commitText(epic.commit)}</span>` : '<button type="submit" name="action" value="commit">Commit</button>'}
          </form>
        </li>`,
    )
    .join('\n')
  const add =
    milestone.otherEpics.length === 0
      ? `      <p class="note">Every one of the team's epics is in this milestone.</p>`
      : `      <form method="post" action="/inputs/epics">
        <label>Add an epic <select name="epic">
${milestone.otherEpics.map((epic) => `          <option value="${escapeHtml(epic.epicId)}">${epicLabel(epic)}</option>`).join('\n')}
        </select></label>
        <button type="submit" name="action" value="add">Add</button>
      </form>`
  return `    <section aria-label="Milestone">
      <h2>${escapeHtml(milestone.name)} · committed ${formatDate(milestone.committedDate)}</h2>
      <form method="post" action="/inputs/milestone/details">${errorLine(details.error)}
${detailsFields(details)}
        <button type="submit">Save name and date</button>
      </form>${errorLine(error)}
      <p>Epics, highest rank first:</p>
      <ol class="epics">
${rows}
      </ol>
${add}
    </section>`
}

function epicLabel(epic: EpicChoice): string {
  return epic.name === epic.key ? escapeHtml(epic.key) : `${escapeHtml(epic.key)} ${escapeHtml(epic.name)}`
}

function errorLine(error: string | undefined): string {
  return error ? `\n        <p class="error" role="alert">${escapeHtml(error)}</p>` : ''
}

const NO_MILESTONE = `    <section aria-label="Pace">
      <p>No milestone defined yet. Define a milestone to enter its pace.</p>
    </section>`

function paceSection(form: PaceForm): string {
  return `    <section aria-label="Pace">
      <h2>Pace</h2>
      <p>How many of this milestone's tickets the team finishes in a week, as a range from a slow week to a good one.</p>
      <form method="post" action="/inputs">${errorLine(form.error)}
        <label>Low <input type="number" name="low" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(form.low)}" required></label>
        <label>High <input type="number" name="high" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(form.high)}" required></label>
        <span>tickets per week</span>
        <p><button type="submit">Save and forecast</button></p>
      </form>
    </section>`
}

/** The category's name as an option label: "Not started". */
function categoryLabel(category: StatusCategory): string {
  const name = STATUS_CATEGORY_NAMES[category]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function workflowSection({ statuses, form, error }: WorkflowScreen): string {
  const rows = statuses
    .map((status) => {
      const chosen = form.categories[status] ?? ''
      const options = [
        `<option value=""${chosen === '' ? ' selected' : ''}>Choose…</option>`,
        ...STATUS_CATEGORIES.map(
          (category) => `<option value="${category}"${chosen === category ? ' selected' : ''}>${categoryLabel(category)}</option>`,
        ),
      ].join('')
      return `          <tr>
            <td>${escapeHtml(status)}</td>
            <td><select name="${STATUS_FIELD}${escapeHtml(status)}" aria-label="What ${escapeHtml(status)} means">${options}</select></td>
          </tr>`
    })
    .join('\n')
  const startedOptions = statuses
    .map(
      (status) =>
        `<option value="${escapeHtml(status)}"${form.startedStatus === status ? ' selected' : ''}>${escapeHtml(status)}</option>`,
    )
    .join('')
  const textField = (name: Exclude<keyof WorkflowForm, 'categories'>, label: string, hint: string): string =>
    `        <p><label>${label} <input type="text" name="${name}" value="${escapeHtml(form[name])}"></label> <span class="note">${hint}</span></p>`
  return `    <section aria-label="Workflow">
      <h2>Workflow</h2>
      <p>How the team's board works: what each status means to the forecast, and which tickets are spikes.</p>
      <form method="post" action="/inputs/workflow">${errorLine(error)}
        <table>
          <thead>
            <tr><th>Board status</th><th>Means</th></tr>
          </thead>
          <tbody>
${rows}
          </tbody>
        </table>
        <p><label>Cycle time starts at <select name="startedStatus">${startedOptions}</select></label> <span class="note">A status that means started.</span></p>
${textField('spikeTypes', 'Spike issue types', 'Comma-separated, e.g. spike.')}
${textField('spikeLabels', 'Spike labels', 'Comma-separated. A ticket with any of these types or labels is a spike.')}
${textField('commitLabel', 'Commit label', 'Optional. Applying it to an epic commits the epic.')}
${textField('blockedStatuses', 'Blocked statuses', 'Comma-separated statuses that mark an epic as blocked.')}
${textField('blockedLabels', 'Blocked labels or flags', 'Comma-separated labels that mark an epic as blocked.')}
        <p><button type="submit">Save workflow</button></p>
      </form>
    </section>`
}
