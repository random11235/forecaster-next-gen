import {
  defaultWorkflowSettings,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_NAMES,
  type StatusCategory,
  type StatusMapping,
  type StatusOrLabelRule,
  type TypeOrLabelRule,
  type WorkflowSettings,
} from '../model/workflow.js'
import type { Facts } from '../model/workItem.js'
import { factsUnderWorkflow } from '../samples/workflowState.js'
import type { Storage } from '../storage/storage.js'
import { refuse, type EditResult } from './editResult.js'

/**
 * The workflow settings as the EM submitted them: a category for each status by name, and the rest as typed. Text is
 * trimmed, and blanks and repeats dropped from lists, when they are saved.
 */
export interface WorkflowEdit {
  /** Each status's category as chosen, by status name; blank when none was chosen. */
  categories: Record<string, string>
  startedStatus: string
  spikeRule: TypeOrLabelRule
  /** Blank for none. */
  commitLabel: string
  blockedRule: StatusOrLabelRule
}

/** What the Inputs screen shows of the team's workflow settings. */
export interface WorkflowSettingsView {
  /**
   * The mapped statuses in the order the EM gave them, then any status a ticket has been in that isn't mapped yet,
   * with no category.
   */
  statuses: { status: string; category: StatusCategory | undefined }[]
  startedStatus: string
  spikeRule: TypeOrLabelRule
  commitLabel: string | undefined
  blockedRule: StatusOrLabelRule
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
  const { statuses, startedStatus, spikeRule, commitLabel, blockedRule } = teamWorkflow(storage, teamId)
  const mapped = new Set(statuses.map((mapping) => mapping.status))
  const unmapped = statusesSeen(storage.facts(teamId)).filter((status) => !mapped.has(status))
  return {
    statuses: [
      ...statuses.map(({ status, category }) => ({ status, category })),
      ...unmapped.map((status) => ({ status, category: undefined })),
    ],
    startedStatus,
    spikeRule,
    commitLabel,
    blockedRule,
  }
}

/** Saves the team's workflow settings as the EM submitted them. Refused settings change nothing. */
export function editWorkflowSettings(storage: Storage, teamId: string, edit: WorkflowEdit): EditResult {
  const seen = statusesSeen(storage.facts(teamId))
  const statuses: StatusMapping[] = []
  for (const [status, category] of Object.entries(edit.categories)) {
    // a status no ticket has been in, left blank, is removed
    if (category.trim() === '' && !seen.includes(status)) continue
    if (!isCategory(category)) return refuse(chooseCategoryMessage(status))
    statuses.push({ status, category })
  }
  const mapped = new Set(statuses.map((mapping) => mapping.status))
  const missing = seen.find((status) => !mapped.has(status))
  if (missing !== undefined) return refuse(chooseCategoryMessage(missing))

  const startedStatus = edit.startedStatus.trim()
  if (!statuses.some((mapping) => mapping.status === startedStatus && mapping.category === 'started')) {
    return refuse('Choose a started status from the statuses mapped to started.')
  }
  const blockedRule = { statuses: cleaned(edit.blockedRule.statuses), labels: cleaned(edit.blockedRule.labels) }
  const notOnBoard = blockedRule.statuses.find((status) => !mapped.has(status))
  if (notOnBoard !== undefined) return refuse(`"${notOnBoard}" isn't a status on the board.`)

  const commitLabel = edit.commitLabel.trim()
  storage.saveWorkflowSettings({
    teamId,
    statuses,
    startedStatus,
    spikeRule: {
      types: cleaned(edit.spikeRule.types.map((type) => type.toLowerCase())),
      labels: cleaned(edit.spikeRule.labels),
    },
    ...(commitLabel !== '' && { commitLabel }),
    blockedRule,
  })
  return { ok: true }
}

/** Every status the team's tickets have been in, in the order first seen. */
function statusesSeen(facts: Facts): string[] {
  const statuses = new Set<string>()
  for (const event of facts.events) {
    if (event.kind !== 'status') continue
    if (event.from !== undefined) statuses.add(event.from)
    if (event.to !== undefined) statuses.add(event.to)
  }
  return [...statuses]
}

/** The entries trimmed, without blanks or repeats. */
function cleaned(entries: readonly string[]): string[] {
  return [...new Set(entries.map((entry) => entry.trim()).filter((entry) => entry !== ''))]
}

/** Asks the EM to map the status, naming the categories it can map to. */
function chooseCategoryMessage(status: string): string {
  const names = STATUS_CATEGORIES.map((category) => STATUS_CATEGORY_NAMES[category])
  return `Choose what "${status}" means: ${names.slice(0, -1).join(', ')} or ${names.at(-1)}.`
}

function isCategory(value: string): value is StatusCategory {
  return (STATUS_CATEGORIES as readonly string[]).includes(value)
}
