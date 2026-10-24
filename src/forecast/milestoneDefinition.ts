import { randomUUID } from 'node:crypto'
import type { WorkItem } from '../model/workItem.js'
import type { Storage } from '../storage/storage.js'

/** A change the EM makes to the team's milestone on the Inputs screen. */
export type MilestoneEdit =
  | { kind: 'create'; name: string; committedDate: string; epicIds: string[] }
  /** Adds the epic last in rank. */
  | { kind: 'addEpic'; epicId: string }
  | { kind: 'removeEpic'; epicId: string }
  /** Moves the epic one place up or down in rank. */
  | { kind: 'moveEpic'; epicId: string; direction: 'up' | 'down' }

/** Whether the edit was saved, or why it was refused. */
export type EditResult = { ok: true } | { ok: false; error: string }

/** An epic as the EM picks it: its key in the ticketing tool, and its title, or its key when it has none. */
export interface EpicChoice {
  epicId: string
  key: string
  name: string
}

/** What the Inputs screen shows of the milestone's definition, and the team's epics the EM can add to it. */
export type MilestoneDefinitionView =
  | { kind: 'noMilestone'; teamEpics: EpicChoice[] }
  | { kind: 'milestone'; name: string; committedDate: string; epics: EpicChoice[]; otherEpics: EpicChoice[] }

/** The team's milestone as defined so far (v1 has one), and the epics the EM can choose from. */
export function milestoneDefinitionView(storage: Storage, teamId: string): MilestoneDefinitionView {
  const epics = teamEpics(storage.facts(teamId).workItems)
  const milestone = storage.milestones(teamId)[0]
  if (!milestone) return { kind: 'noMilestone', teamEpics: epics.map(toChoice) }

  const inMilestone = new Set(milestone.epicIds)
  const byId = new Map(epics.map((epic) => [epic.id, epic]))
  return {
    kind: 'milestone',
    name: milestone.name,
    committedDate: milestone.committedDate,
    epics: milestone.epicIds.map((epicId) => {
      const epic = byId.get(epicId)
      return epic ? toChoice(epic) : { epicId, key: epicId, name: epicId }
    }),
    otherEpics: epics.filter((epic) => !inMilestone.has(epic.id)).map(toChoice),
  }
}

/** Applies the EM's edit to the team's milestone and saves it. A refused edit changes nothing. */
export function editMilestone(storage: Storage, teamId: string, edit: MilestoneEdit): EditResult {
  const milestone = storage.milestones(teamId)[0]
  const isTeamEpic = (epicId: string): boolean =>
    teamEpics(storage.facts(teamId).workItems).some((epic) => epic.id === epicId)

  if (edit.kind === 'create') {
    if (milestone) return refuse('This team already has a milestone.')
    const name = edit.name.trim()
    if (name === '') return refuse('Give the milestone a name.')
    if (!isCalendarDate(edit.committedDate)) return refuse('Enter the committed date as a calendar date.')
    const epicIds = [...new Set(edit.epicIds)]
    if (epicIds.length === 0) return refuse('Choose at least one epic.')
    if (!epicIds.every(isTeamEpic)) return refuse(NOT_A_TEAM_EPIC)
    storage.saveMilestone({ id: randomUUID(), teamId, name, committedDate: edit.committedDate, epicIds })
    return { ok: true }
  }

  if (!milestone) return refuse('Define the milestone first.')
  const epicIds = [...milestone.epicIds]
  const at = epicIds.indexOf(edit.epicId)
  switch (edit.kind) {
    case 'addEpic':
      if (at !== -1) return refuse('That epic is already in the milestone.')
      if (!isTeamEpic(edit.epicId)) return refuse(NOT_A_TEAM_EPIC)
      epicIds.push(edit.epicId)
      break
    case 'removeEpic':
      if (at === -1) return refuse(NOT_IN_MILESTONE)
      if (epicIds.length === 1) return refuse('A milestone holds at least one epic. Add another before removing this one.')
      epicIds.splice(at, 1)
      break
    case 'moveEpic': {
      if (at === -1) return refuse(NOT_IN_MILESTONE)
      const to = edit.direction === 'up' ? at - 1 : at + 1
      if (to < 0 || to >= epicIds.length) return { ok: true }
      ;[epicIds[at], epicIds[to]] = [epicIds[to]!, epicIds[at]!]
      break
    }
  }
  storage.saveMilestone({ ...milestone, epicIds })
  return { ok: true }
}

const NOT_A_TEAM_EPIC = "Choose epics from the team's epics."
const NOT_IN_MILESTONE = 'That epic is not in the milestone.'

function refuse(error: string): EditResult {
  return { ok: false, error }
}

/** `YYYY-MM-DD` naming a day that exists: 2026-02-30 is refused. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
}

/** The team's epics a milestone can hold: cancelled epics are left out. */
function teamEpics(workItems: readonly WorkItem[]): WorkItem[] {
  return workItems.filter((item) => item.type === 'epic' && item.cancelledAt === undefined)
}

function toChoice(epic: WorkItem): EpicChoice {
  return { epicId: epic.id, key: epic.sourceKey, name: epic.title ?? epic.sourceKey }
}
