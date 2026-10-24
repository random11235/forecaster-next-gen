import type { EpicChoice, MilestoneDefinitionView, MilestoneEdit } from '../forecast/milestoneDefinition.js'
import type { ThroughputRange } from '../model/paceSetting.js'
import { escapeHtml, formatDate, htmlPage } from './html.js'

/** Far above any real team's weekly pace; keeps typos like 1000000 out of the forecast. */
const MAX_TICKETS_PER_WEEK = 1000

/** The pace form as typed: what the EM entered, and why it was refused, if it was. */
export interface PaceForm {
  low: string
  high: string
  error?: string
}

export type ParsedPace = { ok: true; range: ThroughputRange } | { ok: false; form: PaceForm }

/** Reads the submitted pace form: whole tickets per week, low ≤ high. */
export function parsePaceForm(body: URLSearchParams): ParsedPace {
  const low = body.get('low')?.trim() ?? ''
  const high = body.get('high')?.trim() ?? ''
  const refuse = (error: string): ParsedPace => ({ ok: false, form: { low, high, error } })
  if (!/^\d+$/.test(low) || !/^\d+$/.test(high)) return refuse('Enter whole numbers of tickets, 0 or more.')
  const [lowCount, highCount] = [Number(low), Number(high)]
  if (highCount > MAX_TICKETS_PER_WEEK) return refuse(`Enter at most ${MAX_TICKETS_PER_WEEK} tickets per week.`)
  if (lowCount > highCount) return refuse('The low end must not be above the high end.')
  return { ok: true, range: { low: lowCount, high: highCount } }
}

/** The new-milestone form as typed, and why it was refused, if it was. */
export interface MilestoneForm {
  name: string
  committedDate: string
  epicIds: string[]
  error?: string
}

/** Reads the submitted new-milestone form; the rules it must meet are checked when it is saved. */
export function parseMilestoneForm(body: URLSearchParams): MilestoneForm {
  return { name: body.get('name') ?? '', committedDate: body.get('committedDate')?.trim() ?? '', epicIds: body.getAll('epic') }
}

/** Reads a submitted epic change: add, remove, or move up or down. Undefined when the form names no change. */
export function parseEpicForm(body: URLSearchParams): MilestoneEdit | undefined {
  const epicId = body.get('epic') ?? ''
  const action = body.get('action')
  switch (action) {
    case 'add':
      return { kind: 'addEpic', epicId }
    case 'remove':
      return { kind: 'removeEpic', epicId }
    case 'up':
    case 'down':
      return { kind: 'moveEpic', epicId, direction: action }
    default:
      return undefined
  }
}

/** What the Inputs screen shows. */
export interface InputsScreen {
  milestone: MilestoneDefinitionView
  /** The new-milestone form as typed, when it was refused. */
  milestoneForm?: MilestoneForm
  /** Why an epic change was refused. */
  epicsError?: string
  /** The pace form; undefined when there is no milestone yet. */
  pace: PaceForm | undefined
}

/** The Inputs screen: the milestone's definition and its manual pace range. */
export function renderInputsScreen(screen: InputsScreen): string {
  const milestone =
    screen.milestone.kind === 'milestone'
      ? epicsSection(screen.milestone, screen.epicsError)
      : newMilestoneSection(screen.milestone.teamEpics, screen.milestoneForm ?? { name: '', committedDate: '', epicIds: [] })
  return htmlPage('Inputs', `${milestone}\n${screen.pace ? paceSection(screen.pace) : NO_MILESTONE}`)
}

function newMilestoneSection(teamEpics: EpicChoice[], form: MilestoneForm): string {
  const chosen = new Set(form.epicIds)
  const epics =
    teamEpics.length === 0
      ? '          <p>The team has no epics yet.</p>'
      : teamEpics
          .map(
            (epic) =>
              `          <label class="epic"><input type="checkbox" name="epic" value="${escapeHtml(epic.epicId)}"${chosen.has(epic.epicId) ? ' checked' : ''}> ${epicLabel(epic)}</label>`,
          )
          .join('\n')
  return `    <section aria-label="Milestone">
      <h2>Milestone</h2>
      <p>Name the milestone, give the date committed to stakeholders, and choose its epics.</p>
      <form method="post" action="/inputs/milestone">${errorLine(form.error)}
        <label>Name <input type="text" name="name" value="${escapeHtml(form.name)}" required></label>
        <label>Committed date <input type="date" name="committedDate" value="${escapeHtml(form.committedDate)}" required></label>
        <fieldset>
          <legend>Epics, highest rank first</legend>
${epics}
        </fieldset>
        <p><button type="submit">Create milestone</button></p>
      </form>
    </section>`
}

function epicsSection(milestone: Extract<MilestoneDefinitionView, { kind: 'milestone' }>, error: string | undefined): string {
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
      <h2>${escapeHtml(milestone.name)} · committed ${formatDate(milestone.committedDate)}</h2>${errorLine(error)}
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
