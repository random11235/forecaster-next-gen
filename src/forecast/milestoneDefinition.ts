import { randomUUID } from 'node:crypto'
import type { Milestone } from '../model/milestone.js'
import { childrenOf, type WorkItem } from '../model/workItem.js'
import type { Storage } from '../storage/storage.js'
import { refuse, type EditResult } from './editResult.js'
import { milestoneEpics, type MilestoneEpic } from './milestoneEpics.js'
import { teamFacts, type TeamFacts } from './teamFacts.js'

/** A change the EM makes to the team's milestone on the Inputs screen. */
export type MilestoneEdit =
  | { kind: 'create'; name: string; committedDate: string; epics: RankedEpic[] }
  /** Renames the milestone and changes its committed date, keeping its epics. */
  | { kind: 'editDetails'; name: string; committedDate: string }
  /** Adds the epic last in rank. */
  | { kind: 'addEpic'; epicId: string }
  | { kind: 'removeEpic'; epicId: string }
  /** Moves the epic one place up or down in rank. */
  | { kind: 'moveEpic'; epicId: string; direction: 'up' | 'down' }
  /**
   * Commits the epic at `at` (an ISO timestamp), recording its child count now as the baseline its growth is measured
   * from. An epic is committed again only once a pull-back has reset its commit; only the latest commit counts.
   */
  | { kind: 'commitEpic'; epicId: string; at: string }

/** An epic the EM chose for a new milestone, and its rank as typed: 1 is the highest. */
export interface RankedEpic {
  epicId: string
  rank: string
}

/** An epic as the EM picks it: its key in the ticketing tool, and its title, or its key when it has none. */
export interface EpicChoice {
  epicId: string
  key: string
  name: string
}

/** What the Inputs screen shows of the milestone's definition, and the team's epics the EM can add to it. */
export type MilestoneDefinitionView =
  | { kind: 'noMilestone'; teamEpics: EpicChoice[] }
  | { kind: 'milestone'; name: string; committedDate: string; epics: MilestoneEpic[]; otherEpics: EpicChoice[] }

/** The team's milestone, if the EM has defined it. v1 forecasts one milestone per team. */
export function teamMilestone(storage: Storage, teamId: string): Milestone | undefined {
  return storage.milestones(teamId)[0]
}

/** The team's milestone as defined so far (v1 has one), and the epics the EM can choose from. */
export function milestoneDefinitionView(storage: Storage, teamId: string, team: TeamFacts): MilestoneDefinitionView {
  const epics = teamEpics(team)
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return { kind: 'noMilestone', teamEpics: epics.map(toChoice) }

  const inMilestone = new Set(milestone.epicIds)
  return {
    kind: 'milestone',
    name: milestone.name,
    committedDate: milestone.committedDate,
    epics: milestoneEpics(milestone, team),
    otherEpics: epics.filter((epic) => !inMilestone.has(epic.id)).map(toChoice),
  }
}

/** Applies the EM's edit to the team's milestone and saves it. A refused edit changes nothing. */
export function editMilestone(storage: Storage, teamId: string, edit: MilestoneEdit): EditResult {
  const milestone = teamMilestone(storage, teamId)
  const team = teamFacts(storage, teamId)
  const teamEpicIds = new Set(teamEpics(team).map((epic) => epic.id))
  const isTeamEpic = (epicId: string): boolean => teamEpicIds.has(epicId)

  if (edit.kind === 'create') {
    if (milestone) return refuse('This team already has a milestone.')
    const details = checkedDetails(edit)
    if (!details.ok) return details
    if (edit.epics.length === 0) return refuse('Choose at least one epic.')
    if (!edit.epics.every((epic) => isTeamEpic(epic.epicId))) return refuse(NOT_A_TEAM_EPIC)
    const ranked = inRankOrder(edit.epics)
    if (!ranked.ok) return ranked
    storage.saveMilestone({ id: randomUUID(), teamId, ...details.details, epicIds: ranked.epicIds })
    return { ok: true }
  }

  if (!milestone) return refuse('Define the milestone first.')
  if (edit.kind === 'commitEpic') {
    if (!milestone.epicIds.includes(edit.epicId)) return refuse(NOT_IN_MILESTONE)
    if (team.commits.has(edit.epicId)) return refuse('That epic is already committed.')
    const baseline = childrenOf(team.facts.workItems, edit.epicId).length
    storage.saveEpicCommit({ teamId, epicId: edit.epicId, committedAt: edit.at, baseline })
    return { ok: true }
  }
  if (edit.kind === 'editDetails') {
    const details = checkedDetails(edit)
    if (!details.ok) return details
    storage.saveMilestone({ ...milestone, ...details.details })
    return { ok: true }
  }
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

/** Reads an epic change submitted from the Inputs screen at `at` (an ISO timestamp): add, remove, move up or down, or commit. */
export function parseEpicForm(body: URLSearchParams, at: string): { ok: true; edit: MilestoneEdit } | { ok: false; error: string } {
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
      return refuse('Choose Add, Remove, Up, Down or Commit.')
  }
}

const NOT_A_TEAM_EPIC = "Choose epics from the team's epics."
const NOT_IN_MILESTONE = 'That epic is not in the milestone.'

/** The milestone's name, trimmed, and its committed date, if both are valid. */
function checkedDetails(typed: {
  name: string
  committedDate: string
}): { ok: true; details: { name: string; committedDate: string } } | { ok: false; error: string } {
  const name = typed.name.trim()
  if (name === '') return refuse('Give the milestone a name.')
  if (!isCalendarDate(typed.committedDate)) return refuse('Enter the committed date as a calendar date.')
  return { ok: true, details: { name, committedDate: typed.committedDate } }
}

/** The chosen epics' IDs in the rank the EM gave them, which must be 1 to the number chosen, each once. */
function inRankOrder(epics: readonly RankedEpic[]): { ok: true; epicIds: string[] } | { ok: false; error: string } {
  if (new Set(epics.map((epic) => epic.epicId)).size < epics.length) return refuse('Choose each epic once.')
  const ranks = epics.map((epic) => epic.rank.trim())
  if (ranks.includes('')) return refuse('Give each chosen epic a rank.')
  if (new Set(ranks).size < ranks.length) return refuse('Give each chosen epic a different rank.')
  const inRange = (rank: string): boolean => /^\d+$/.test(rank) && Number(rank) >= 1 && Number(rank) <= epics.length
  if (!ranks.every(inRange)) return refuse(`Rank the chosen epics 1 to ${epics.length}, with none missing.`)
  const epicIds: string[] = []
  epics.forEach((epic, i) => (epicIds[Number(ranks[i]) - 1] = epic.epicId))
  return { ok: true, epicIds }
}

/** `YYYY-MM-DD` naming a day that exists: 2026-02-30 is refused. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const day = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value
}

/** The team's epics a milestone can hold: cancelled epics are left out. */
function teamEpics(team: TeamFacts): WorkItem[] {
  return team.facts.workItems.filter((item) => item.type === 'epic' && item.cancelledAt === undefined)
}

function toChoice(epic: WorkItem): EpicChoice {
  return { epicId: epic.id, key: epic.sourceKey, name: epic.title ?? epic.sourceKey }
}
