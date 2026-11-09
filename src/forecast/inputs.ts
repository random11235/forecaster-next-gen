import type { Ambiguity } from '../model/ambiguity.js'
import type { Storage } from '../storage/storage.js'
import { editCapacity, type CapacityEdit, type CapacityForm, type CapacityView } from './capacity.js'
import type { EditResult } from './editResult.js'
import { milestoneForecastView, type ForecastViewOptions, type MilestoneForecastView } from './milestoneForecastView.js'
import { editGrowth, growthView, type GrowthEdit, type GrowthView, type TypedRange } from './growth.js'
import { editMilestoneInputs, milestoneInputsView, type MilestoneInputsEdit, type MilestoneInputsView } from './milestoneInputs.js'
import type { ForecastSettings } from './settings.js'

/**
 * A form the EM submits, as typed: on the Inputs screen, to the milestone and its pace, or to the team's ambiguity
 * ranges; beside the forecast, to the team's capacity.
 */
export type InputsEdit = MilestoneInputsEdit | GrowthEdit | CapacityEdit

/** A form on the Inputs screen, which a refusal is shown on. The typed counts' list, add and remove share one. */
export type InputsForm = 'milestone' | 'cadence' | 'paceMode' | 'paceRange' | 'paceCounts' | 'ambiguity' | 'growth'

/** What the forms with typed fields show: as saved, or as typed when refused. The choices show what is saved. */
export interface TypedForms {
  milestone: { name: string; startDate: string; ticketsRemaining: string }
  cadence: { cadenceDays: string }
  paceRange: TypedRange
  /** The list, oldest first, apart by commas, and the newest count to add after it. */
  paceCounts: { counts: string; count: string }
  growth: Record<Ambiguity, TypedRange>
}

/** Why a submitted form was refused, and which form says so. */
export interface FormRefusal {
  form: InputsForm
  error: string
}

/** What the Inputs screen shows. */
export interface InputsView {
  /** The milestone the forecast starts from, as entered so far. */
  milestone: MilestoneInputsView
  growth: GrowthView
  forms: TypedForms
  /** Why the form just submitted was refused; none until one is. */
  refusal?: FormRefusal
}

/** A screen a form goes to: the Inputs screen, or the Milestone forecast screen. */
export type NextScreen = 'inputs' | 'forecast'

/**
 * A refused form's screen to show again, each with its refusal and the form as typed: the Inputs screen, or the
 * Milestone forecast screen (whose view carries the refusal of a form on it).
 */
export type RefusedScreen = { screen: 'inputs'; view: InputsView & { refusal: FormRefusal } } | { screen: 'forecast'; view: MilestoneForecastView }

/** A submitted form saved, and the screen to go to next; or refused, naming the screen to show again. */
export type Submitted = { saved: true; next: NextScreen } | ({ saved: false } & RefusedScreen)

/** Seam B: the Inputs screen for the team, its notes judged against `settings`, on `today`, the start date's default. */
export function inputsView(storage: Storage, teamId: string, settings: ForecastSettings, today: string): InputsView {
  const milestone = milestoneInputsView(storage, teamId, settings, today)
  const growth = growthView(storage, teamId)
  return { milestone, growth, forms: savedForms(milestone, growth) }
}

/**
 * Seam B: saves a form the EM submitted. Refused, nothing changes, and the result names the screen to show again: the
 * form as typed, saying why, beside the rest as saved. The capacity forms are on the Milestone forecast screen, shown
 * again as it was (`shown`) with its Capacity section open; every other form is on the Inputs screen.
 */
export function submitInputs(
  storage: Storage,
  teamId: string,
  settings: ForecastSettings,
  today: string,
  edit: InputsEdit,
  shown: ForecastViewOptions = {},
): Submitted {
  if (edit.kind === 'addCapacity' || edit.kind === 'editCapacity' || edit.kind === 'removeCapacity' || edit.kind === 'switchCapacity') return submitCapacity(storage, teamId, settings, today, edit, shown)
  const { form, next, typed } = submission(edit)
  const result: EditResult = edit.kind === 'setAmbiguityRanges' ? editGrowth(storage, teamId, edit) : editMilestoneInputs(storage, teamId, edit)
  if (result.ok) return { saved: true, next }
  const screen = inputsView(storage, teamId, settings, today)
  const view = { ...screen, forms: { ...screen.forms, ...typed(screen.forms) }, refusal: { form, error: result.error } }
  return { saved: false, screen: 'inputs', view }
}

/**
 * A capacity form, saved, goes to the forecast it changes. Refused, the Milestone forecast screen shows it again as
 * typed with why; a screen with no forecast yet has no capacity section to show it on.
 */
function submitCapacity(storage: Storage, teamId: string, settings: ForecastSettings, today: string, edit: CapacityEdit, shown: ForecastViewOptions): Submitted {
  const result = editCapacity(storage, teamId, today, edit)
  if (result.ok) return { saved: true, next: 'forecast' }
  const view = milestoneForecastView(storage, teamId, settings, today, shown)
  if (view.kind !== 'forecast') return { saved: false, screen: 'forecast', view }
  // open to say why, whether or not it was open when submitted
  return { saved: false, screen: 'forecast', view: { ...view, capacity: { ...view.capacity, open: true, ...refusedCapacity(edit, result.error) } } }
}

/** A refused capacity form as typed, with why: the add sentence, or the edit form of the entry it was on. */
function refusedCapacity(edit: CapacityEdit, refusal: string): Partial<CapacityView> {
  const typed = (form: CapacityForm): CapacityForm => ({ percent: form.percent, from: form.from, to: form.to, onward: form.onward, note: form.note })
  switch (edit.kind) {
    case 'addCapacity':
      return { form: typed(edit), refusal }
    case 'editCapacity':
      return { editing: { id: Number(edit.id), form: typed(edit), refusal } }
    case 'removeCapacity':
    case 'switchCapacity':
      return { refusal }
  }
}

/** A submitted form: which it is, where a saved one goes, and what a refused one shows again over the saved forms. */
interface Submission {
  form: InputsForm
  next: NextScreen
  typed: (saved: TypedForms) => Partial<TypedForms>
}

function submission(edit: Exclude<InputsEdit, CapacityEdit>): Submission {
  const asSaved = () => ({})
  switch (edit.kind) {
    case 'setMilestone': {
      const { name, startDate, ticketsRemaining } = edit
      return { form: 'milestone', next: 'inputs', typed: () => ({ milestone: { name, startDate, ticketsRemaining } }) }
    }
    case 'setCadence':
      return { form: 'cadence', next: 'inputs', typed: () => ({ cadence: { cadenceDays: edit.cadenceDays } }) }
    case 'setPaceRange':
      return { form: 'paceRange', next: 'forecast', typed: () => ({ paceRange: { low: edit.low, high: edit.high } }) }
    case 'setPaceMode':
      return { form: 'paceMode', next: 'forecast', typed: asSaved }
    case 'setPaceCounts':
      return { form: 'paceCounts', next: 'inputs', typed: () => ({ paceCounts: { counts: edit.counts, count: '' } }) }
    case 'addPaceCount':
      return { form: 'paceCounts', next: 'inputs', typed: (saved) => ({ paceCounts: { ...saved.paceCounts, count: edit.count } }) }
    case 'removeLastPaceCount':
      return { form: 'paceCounts', next: 'inputs', typed: asSaved }
    case 'setAmbiguity':
      return { form: 'ambiguity', next: 'forecast', typed: asSaved }
    case 'setAmbiguityRanges':
      return { form: 'growth', next: 'inputs', typed: () => ({ growth: { low: edit.low, medium: edit.medium, high: edit.high } }) }
  }
}

/** Each form filled with what is saved: the start date pre-filled with today until one is, blanks for what isn't. */
function savedForms(milestone: MilestoneInputsView, { ranges }: GrowthView): TypedForms {
  const typed = ({ low, high }: { low: number; high: number }): TypedRange => ({ low: String(low), high: String(high) })
  const { paceRange, ticketsRemaining } = milestone
  return {
    milestone: { name: milestone.name, startDate: milestone.startDate, ticketsRemaining: ticketsRemaining === undefined ? '' : String(ticketsRemaining) },
    cadence: { cadenceDays: String(milestone.cadenceDays) },
    paceRange: paceRange ? typed(paceRange) : { low: '', high: '' },
    paceCounts: { counts: milestone.paceCounts.join(', '), count: '' },
    growth: { low: typed(ranges.low), medium: typed(ranges.medium), high: typed(ranges.high) },
  }
}
