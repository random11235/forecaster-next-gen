import { defaultWorkflowSettings, STATUS_CATEGORIES, type StatusCategory, type StatusMapping, type WorkflowSettings } from '../model/workflow.js'
import type { Facts } from '../model/workItem.js'
import { factsUnderWorkflow } from '../samples/workflowState.js'
import type { Storage } from '../storage/storage.js'
import type { EditResult } from './milestoneDefinition.js'

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

/** What the Inputs screen shows of the team's workflow settings. */
export interface WorkflowSettingsView {
  /**
   * The mapped statuses in the order the EM gave them, then any status on the board that isn't mapped yet, with no
   * category.
   */
  statuses: { status: string; category: StatusCategory | undefined }[]
  startedStatus: string
  spikeTypes: string[]
  spikeLabels: string[]
  commitLabel: string | undefined
  blockedStatuses: string[]
  blockedLabels: string[]
}

/** The team's workflow settings: as the EM set them, or the sample board's until then. */
export function teamWorkflow(storage: Storage, teamId: string): WorkflowSettings {
  return storage.workflowSettings(teamId) ?? defaultWorkflowSettings(teamId)
}

/** The team's facts as its workflow reads them: started, done and cancelled come from the status mapping. */
export function teamFacts(storage: Storage, teamId: string): Facts {
  return factsUnderWorkflow(storage.facts(teamId), teamWorkflow(storage, teamId))
}

export function workflowSettingsView(storage: Storage, teamId: string): WorkflowSettingsView {
  const workflow = teamWorkflow(storage, teamId)
  const mapped = new Set(workflow.statuses.map((mapping) => mapping.status))
  const unmapped = boardStatuses(storage.facts(teamId)).filter((status) => !mapped.has(status))
  return {
    statuses: [
      ...workflow.statuses.map(({ status, category }) => ({ status, category })),
      ...unmapped.map((status) => ({ status, category: undefined })),
    ],
    startedStatus: workflow.startedStatus,
    spikeTypes: workflow.spikeRule.types,
    spikeLabels: workflow.spikeRule.labels,
    commitLabel: workflow.commitLabel,
    blockedStatuses: workflow.blockedRule.statuses,
    blockedLabels: workflow.blockedRule.labels,
  }
}

/** Saves the team's workflow settings as the EM typed them. Refused settings change nothing. */
export function editWorkflowSettings(storage: Storage, teamId: string, typed: WorkflowForm): EditResult {
  const onBoard = boardStatuses(storage.facts(teamId))
  const statuses: StatusMapping[] = []
  for (const [status, category] of Object.entries(typed.categories)) {
    // a status no ticket has been in, left blank, is removed
    if (category.trim() === '' && !onBoard.includes(status)) continue
    if (!isCategory(category)) return refuse(unmapped(status))
    statuses.push({ status, category })
  }
  const mapped = new Set(statuses.map((mapping) => mapping.status))
  const missing = onBoard.find((status) => !mapped.has(status))
  if (missing !== undefined) return refuse(unmapped(missing))

  const startedStatus = typed.startedStatus.trim()
  if (!statuses.some((mapping) => mapping.status === startedStatus && mapping.category === 'started')) {
    return refuse('Choose a started status from the statuses mapped to started.')
  }
  const blockedStatuses = list(typed.blockedStatuses)
  const notOnBoard = blockedStatuses.find((status) => !mapped.has(status))
  if (notOnBoard !== undefined) return refuse(`"${notOnBoard}" isn't a status on the board.`)

  const commitLabel = typed.commitLabel.trim()
  storage.saveWorkflowSettings({
    teamId,
    statuses,
    startedStatus,
    spikeRule: { types: list(typed.spikeTypes).map((type) => type.toLowerCase()), labels: list(typed.spikeLabels) },
    ...(commitLabel !== '' && { commitLabel }),
    blockedRule: { statuses: blockedStatuses, labels: list(typed.blockedLabels) },
  })
  return { ok: true }
}

/** Every status the board's tickets have been in, in the order first seen. */
function boardStatuses(facts: Facts): string[] {
  const statuses = new Set<string>()
  for (const event of facts.events) {
    if (event.kind !== 'status') continue
    if (event.from !== undefined) statuses.add(event.from)
    if (event.to !== undefined) statuses.add(event.to)
  }
  return [...statuses]
}

/** A comma-separated list, trimmed, without blanks or repeats. */
function list(typed: string): string[] {
  return [...new Set(typed.split(',').map((entry) => entry.trim()).filter((entry) => entry !== ''))]
}

function unmapped(status: string): string {
  return `Choose what "${status}" means: not started, started, done or cancelled.`
}

function isCategory(value: string): value is StatusCategory {
  return (STATUS_CATEGORIES as readonly string[]).includes(value)
}

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
