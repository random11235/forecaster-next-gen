import type { EpicChoice, MilestoneDefinitionView, RankedEpic } from '../forecast/milestoneDefinition.js'
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
}

/** The Inputs screen: the milestone's definition and its manual pace range. */
export function renderInputsScreen(screen: InputsScreen): string {
  const milestone =
    screen.milestone.kind === 'milestone'
      ? epicsSection(screen.milestone, screen.detailsForm ?? screen.milestone, screen.epicsError)
      : newMilestoneSection(screen.milestone.teamEpics, screen.milestoneForm ?? { name: '', committedDate: '', ranks: {} })
  return htmlPage('Inputs', `${milestone}\n${screen.pace ? paceSection(screen.pace) : NO_MILESTONE}`)
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
