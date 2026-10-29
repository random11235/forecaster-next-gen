import {
  MAX_TICKETS_PER_WEEK,
  MAX_TICKETS_REMAINING,
  type MilestoneInput,
  type InputNote,
  type MilestoneInputsView,
} from '../forecast/milestoneInputs.js'
import { ambiguityName, MAX_GROWTH, type GrowthView, type TypedRange } from '../forecast/growth.js'
import type { WorkflowEdit, WorkflowSettingsView } from '../forecast/workflowSettings.js'
import { AMBIGUITIES, type Ambiguity } from '../model/ambiguity.js'
import { STATUS_CATEGORIES, STATUS_CATEGORY_NAMES, type StatusCategory } from '../model/workflow.js'
import { escapeHtml, htmlPage } from './html.js'

/** Each input of the milestone by its label on this screen, which notes about it are named by everywhere. */
export const INPUT_LABELS: Record<MilestoneInput, string> = {
  name: 'Name',
  startDate: 'Start date',
  ticketsRemaining: 'Tickets remaining',
  pace: 'Pace',
}

/** The pace form as typed: what the EM entered, and why it was refused, if it was. */
export interface PaceForm {
  low: string
  high: string
  error?: string
}

/** Reads the submitted pace form; the rules it must meet are checked when it is saved. */
export function parsePaceForm(body: URLSearchParams): PaceForm {
  return { low: body.get('low')?.trim() ?? '', high: body.get('high')?.trim() ?? '' }
}

/** The pace form filled with the saved range, or empty. */
export function savedPaceForm(view: MilestoneInputsView): PaceForm {
  return view.paceRange ? { low: String(view.paceRange.low), high: String(view.paceRange.high) } : { low: '', high: '' }
}

/** The ambiguity ranges form as typed: each level's low and high, and why they were refused, if they were. */
export interface GrowthForm {
  ranges: Record<Ambiguity, TypedRange>
  error?: string
}

/** Reads the submitted ambiguity ranges; the rules they must meet are checked when they are saved. */
export function parseGrowthForm(body: URLSearchParams): GrowthForm {
  const typed = (level: Ambiguity): TypedRange => ({ low: body.get(`${level}-low`) ?? '', high: body.get(`${level}-high`) ?? '' })
  return { ranges: { low: typed('low'), medium: typed('medium'), high: typed('high') } }
}

/** The ambiguity ranges form filled with the team's saved ranges. */
export function savedGrowthForm({ ranges }: GrowthView): GrowthForm {
  const typed = ({ low, high }: { low: number; high: number }): TypedRange => ({ low: String(low), high: String(high) })
  return { ranges: { low: typed(ranges.low), medium: typed(ranges.medium), high: typed(ranges.high) } }
}


/** The milestone form as typed, and why it was refused, if it was. */
export interface MilestoneForm {
  name: string
  startDate: string
  ticketsRemaining: string
  error?: string
}

/** Reads the submitted milestone form; the rules it must meet are checked when it is saved. */
export function parseMilestoneForm(body: URLSearchParams): MilestoneForm {
  return {
    name: body.get('name') ?? '',
    startDate: body.get('startDate')?.trim() ?? '',
    ticketsRemaining: body.get('ticketsRemaining')?.trim() ?? '',
  }
}

/** The milestone form filled with what is saved, the start date pre-filled with today until one is. */
export function savedMilestoneForm(view: MilestoneInputsView): MilestoneForm {
  return { name: view.name, startDate: view.startDate, ticketsRemaining: view.ticketsRemaining === undefined ? '' : String(view.ticketsRemaining) }
}

/** The workflow settings form as typed: a category for each status by name, and the rest as text. */
export interface WorkflowForm {
  /** Each status's category as chosen, by status name; blank when none was chosen. */
  categories: Record<string, string>
  startedStatus: string
  /** Blank for none. */
  commitLabel: string
  /** Comma-separated lists. */
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
    commitLabel: text('commitLabel'),
    blockedStatuses: text('blockedStatuses'),
    blockedLabels: text('blockedLabels'),
  }
  const list = (typed: string): string[] => typed.split(',')
  const edit: WorkflowEdit = {
    categories,
    startedStatus: form.startedStatus,
    commitLabel: form.commitLabel,
    blockedRule: { statuses: list(form.blockedStatuses), labels: list(form.blockedLabels) },
  }
  return { form, edit }
}

/** The workflow settings form filled with the team's saved settings. */
export function savedWorkflowForm({ statuses, startedStatus, commitLabel, blockedRule }: WorkflowSettingsView): WorkflowForm {
  return {
    categories: Object.fromEntries(statuses.map(({ status, category }) => [status, category ?? ''])),
    startedStatus,
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
  milestone: MilestoneInputsView
  /** The milestone form, as saved or as typed when refused. */
  milestoneForm: MilestoneForm
  /** The pace form, as saved or as typed when refused. */
  paceForm: PaceForm
  /** The ambiguity ranges form, as saved or as typed when refused. */
  growth: GrowthForm
}

/** The Inputs screen: the milestone, its pace and the team's growth. */
export function renderInputsScreen(screen: InputsScreen): string {
  const { milestone } = screen
  const sections = [
    milestoneSection(screen.milestoneForm, milestone.notes),
    paceSection(screen.paceForm, milestone.notes),
    growthSection(screen.growth),
  ]
  const header = {
    context: milestone.name === '' ? undefined : escapeHtml(milestone.name),
    heading: 'Inputs',
    lede: 'What drives the forecast: the milestone, the team’s pace, and how work grows.',
  }
  return htmlPage('Inputs', '/inputs', header, sections.map((section, index) => section(index + 1)).join('\n'))
}

/** A section of the Inputs screen, given its number on the screen. */
type Section = (number: number) => string

/** A numbered section: its name and hint in the label column, `body` beside them. */
function inputSection(label: string, name: string, hint: string, body: string): Section {
  return (number) => `    <section class="input" aria-label="${label}">
      <div class="label">
        <span class="number">${String(number).padStart(2, '0')}</span>
        <h2>${name}</h2>
        <p>${hint}</p>
      </div>
      <div class="body">
${body}
      </div>
    </section>`
}

function milestoneSection(form: MilestoneForm, notes: readonly InputNote[]): Section {
  return inputSection(
    'Milestone',
    'Milestone',
    'Name the milestone, the date work on it starts, and how many tickets are left.',
    `        <form method="post" action="/inputs/milestone">${errorLine(form.error)}
          <div class="fields">
            <label class="wide">${INPUT_LABELS.name} <input type="text" name="name" value="${escapeHtml(form.name)}" required></label>${notesFor('name', notes)}
            <label>${INPUT_LABELS.startDate} <input type="date" name="startDate" value="${escapeHtml(form.startDate)}" required></label>${notesFor('startDate', notes)}
            <label>${INPUT_LABELS.ticketsRemaining} <input type="number" name="ticketsRemaining" min="0" max="${MAX_TICKETS_REMAINING}" step="1" value="${escapeHtml(form.ticketsRemaining)}" required></label>${notesFor('ticketsRemaining', notes)}
          </div>
          <div class="actions"><button type="submit" class="primary">Save milestone</button></div>
        </form>`,
  )
}

/** The notes about one input, shown beside it. */
function notesFor(input: MilestoneInput, notes: readonly InputNote[]): string {
  return notes
    .filter((note) => note.input === input)
    .map((note) => `\n            <p class="warning">⚠ ${escapeHtml(note.message)}</p>`)
    .join('')
}

function errorLine(error: string | undefined): string {
  return error ? `\n          <p class="error" role="alert">${escapeHtml(error)}</p>` : ''
}

function paceSection(form: PaceForm, notes: readonly InputNote[]): Section {
  return inputSection(
    INPUT_LABELS.pace,
    INPUT_LABELS.pace,
    'How many tickets the team finishes in a week, from a slow week to a good one.',
    `        <form method="post" action="/inputs/pace">${errorLine(form.error)}
          <div class="pace">
            <label>Low <input type="number" name="low" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(form.low)}" required></label>
            <span class="to">to</span>
            <label>High <input type="number" name="high" min="0" max="${MAX_TICKETS_PER_WEEK}" step="1" value="${escapeHtml(form.high)}" required></label>
            <span class="unit">tickets per week</span>
          </div>${notesFor('pace', notes)}
          <div class="actions"><button type="submit" class="primary">Save and forecast</button></div>
        </form>`,
  )
}

function growthSection(form: GrowthForm): Section {
  const rows = AMBIGUITIES.map((level) => {
    const field = (end: 'low' | 'high'): string =>
      `<input type="number" name="${level}-${end}" min="0" max="${MAX_GROWTH}" step="any" value="${escapeHtml(form.ranges[level][end])}" aria-label="${ambiguityName(level)} ambiguity, ${end} end" required>`
    return `              <tr>
                <td>${ambiguityName(level)}</td>
                <td>${field('low')} <span class="to">to</span> ${field('high')} <span class="unit">× the baseline</span></td>
              </tr>`
  }).join('\n')
  return inputSection(
    'Growth',
    'Growth',
    'How much the work may grow, by how well it is understood. For now the milestone grows by the medium range.',
    `        <form method="post" action="/inputs/growth">${errorLine(form.error)}
          <table class="growth">
            <thead>
              <tr><th>Ambiguity</th><th>Grows by</th></tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
          <div class="actions"><button type="submit">Save ranges</button></div>
        </form>`,
  )
}

/** The category's name as an option label: "Not started". */
function categoryLabel(category: StatusCategory): string {
  const name = STATUS_CATEGORY_NAMES[category]
  return name.charAt(0).toUpperCase() + name.slice(1)
}

function workflowSection({ statuses, form, error }: WorkflowScreen): Section {
  const rows = statuses
    .map((status) => {
      const chosen = form.categories[status] ?? ''
      const options = [
        `<option value=""${chosen === '' ? ' selected' : ''}>Choose…</option>`,
        ...STATUS_CATEGORIES.map(
          (category) => `<option value="${category}"${chosen === category ? ' selected' : ''}>${categoryLabel(category)}</option>`,
        ),
      ].join('')
      return `              <tr>
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
    `            <label class="field">${label} <input type="text" name="${name}" value="${escapeHtml(form[name])}"> <span class="note">${hint}</span></label>`
  return inputSection(
    'Workflow',
    'Workflow',
    'How the team’s board works: what each status means to the forecast, and what commits or blocks an epic.',
    `        <form method="post" action="/inputs/workflow">${errorLine(error)}
          <table class="workflow">
            <thead>
              <tr><th>Board status</th><th>Means</th></tr>
            </thead>
            <tbody>
${rows}
            </tbody>
          </table>
          <div class="settings">
            <label class="field">Cycle time starts at <select name="startedStatus">${startedOptions}</select> <span class="note">A status that means started.</span></label>
${textField('commitLabel', 'Commit label', 'Optional. Applying it to an epic commits the epic.')}
${textField('blockedStatuses', 'Blocked statuses', 'Comma-separated statuses that mark an epic as blocked.')}
${textField('blockedLabels', 'Blocked labels or flags', 'Comma-separated labels that mark an epic as blocked.')}
          </div>
          <div class="actions"><button type="submit" class="primary">Save workflow</button></div>
        </form>`,
  )
}
