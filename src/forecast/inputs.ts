import type { ThroughputRange } from '../model/paceSetting.js'
import type { Storage } from '../storage/storage.js'
import { refuse, type EditResult } from './editResult.js'
import { editGrowth, growthView, type GrowthEdit, type GrowthView } from './growth.js'
import { editMilestone, milestoneDefinitionView, teamMilestone, type MilestoneDefinitionView, type MilestoneEdit } from './milestoneDefinition.js'
import { teamFacts } from './teamFacts.js'
import { editWorkflowSettings, workflowSettingsView, type WorkflowEdit, type WorkflowSettingsView } from './workflowSettings.js'

/** Far above any real team's weekly pace; keeps typos like 1000000 out of the forecast. */
export const MAX_TICKETS_PER_WEEK = 1000

/** A change the EM makes on the Inputs screen: to the milestone, the team's workflow settings, or the milestone's pace. */
export type InputsEdit =
  | MilestoneEdit
  | GrowthEdit
  | ({ kind: 'editWorkflow' } & WorkflowEdit)
  /** The milestone's manual pace as typed: whole tickets per week, low ≤ high. */
  | { kind: 'setPace'; low: string; high: string }

/** What the Inputs screen shows. */
export interface InputsView {
  milestone: MilestoneDefinitionView
  /** The milestone's manual pace range, if the EM has entered one. */
  pace: ThroughputRange | undefined
  workflow: WorkflowSettingsView
  growth: GrowthView
}

/** Seam B: the Inputs screen for the team, reading its facts from storage once. */
export function inputsView(storage: Storage, teamId: string): InputsView {
  const team = teamFacts(storage, teamId)
  const milestone = teamMilestone(storage, teamId)
  const pace = milestone && storage.paceSetting(teamId, milestone.id)
  return {
    milestone: milestoneDefinitionView(storage, teamId, team),
    pace: pace?.mode === 'manual' ? { low: pace.low, high: pace.high } : undefined,
    workflow: workflowSettingsView(team),
    growth: growthView(storage, teamId, team),
  }
}

/** Seam B: applies the EM's edit from the Inputs screen and saves it. A refused edit changes nothing and says why. */
export function editInputs(storage: Storage, teamId: string, edit: InputsEdit): EditResult {
  switch (edit.kind) {
    case 'setPace':
      return setPace(storage, teamId, edit)
    case 'editWorkflow': {
      const { kind: _kind, ...settings } = edit
      return editWorkflowSettings(storage, teamId, settings)
    }
    case 'setEpicAmbiguity':
    case 'setAmbiguityRanges':
    case 'useMeasuredMedium':
    case 'useMediumRange':
      return editGrowth(storage, teamId, teamFacts(storage, teamId), edit)
    default:
      return editMilestone(storage, teamId, edit)
  }
}

function setPace(storage: Storage, teamId: string, typed: { low: string; high: string }): EditResult {
  const milestone = teamMilestone(storage, teamId)
  if (!milestone) return refuse('Define the milestone first.')
  const [low, high] = [typed.low.trim(), typed.high.trim()]
  if (!/^\d+$/.test(low) || !/^\d+$/.test(high)) return refuse('Enter whole numbers of tickets, 0 or more.')
  const range = { low: Number(low), high: Number(high) }
  if (range.high > MAX_TICKETS_PER_WEEK) return refuse(`Enter at most ${MAX_TICKETS_PER_WEEK} tickets per week.`)
  if (range.low > range.high) return refuse('The low end must not be above the high end.')
  storage.savePaceSetting({ teamId, milestoneId: milestone.id, mode: 'manual', ...range })
  return { ok: true }
}
