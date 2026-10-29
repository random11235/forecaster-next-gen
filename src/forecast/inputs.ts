import type { Storage } from '../storage/storage.js'
import type { EditResult } from './editResult.js'
import type { ForecastSettings } from './settings.js'
import { editGrowth, growthView, type GrowthEdit, type GrowthView } from './growth.js'
import { editMilestoneInputs, milestoneInputsView, type MilestoneInputsEdit, type MilestoneInputsView } from './milestoneInputs.js'

/** A change the EM makes on the Inputs screen: to the milestone and its pace, or to the team's ambiguity ranges. */
export type InputsEdit = MilestoneInputsEdit | GrowthEdit

/** What the Inputs screen shows. */
export interface InputsView {
  /** The milestone the forecast starts from, as entered so far. */
  milestone: MilestoneInputsView
  growth: GrowthView
}

/** Seam B: the Inputs screen for the team, its notes judged against `settings`, on `today`, the start date's default. */
export function inputsView(storage: Storage, teamId: string, settings: ForecastSettings, today: string): InputsView {
  return {
    milestone: milestoneInputsView(storage, teamId, settings, today),
    growth: growthView(storage, teamId),
  }
}

/** Seam B: applies the EM's edit from the Inputs screen and saves it. A refused edit changes nothing and says why. */
export function editInputs(storage: Storage, teamId: string, edit: InputsEdit): EditResult {
  switch (edit.kind) {
    case 'setMilestone':
    case 'setPaceRange':
    case 'setAmbiguity':
    case 'setCadence':
    case 'setPaceCounts':
    case 'addPaceCount':
    case 'removeLastPaceCount':
    case 'setPaceMode':
      return editMilestoneInputs(storage, teamId, edit)
    case 'setAmbiguityRanges':
      return editGrowth(storage, teamId, edit)
  }
}
