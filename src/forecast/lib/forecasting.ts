import type { ChoiceKind } from '../../model/choice.js'
import type { CandidateOpening } from './candidates.js'
import type { HowItWorksView } from './howItWorksView.js'
import { inputsScreen, type InputsOpening, type InputsScreen } from './inputsScreenView.js'
import type { MilestoneForecastView } from './milestoneForecastView.js'
import type { ChoiceList } from './queryStep.js'
import type { StepQuery } from './stepQuery.js'
import { submit, type Edit, type Outcome, type SubmitOpening } from './submit.js'
import { openTeamEntries, type CapacityShown, type ForecastingOptions } from './teamEntries.js'

export type { Clock, CapacityShown, ForecastingOptions } from './teamEntries.js'
export type { InputsOpening, InputsScreen, QuerySetupStep } from './inputsScreenView.js'
export type { Edit, Outcome, Place, SubmitOpening } from './submit.js'

/**
 * Seam B: the team's handle, each screen's view, whole, and one submit for every form, on today, the clock's date in
 * the EM's time zone. The steps and their submits need what the local server build connects with (`connects`):
 * without it, the views have none, and a submit of one is refused by throwing, as the browser build never sends one.
 */
export interface Forecasting {
  /** Whether it connects a tracker: the local server build, which alone has the setup steps. */
  readonly connects: boolean
  milestoneForecastView(shown?: CapacityShown): Promise<MilestoneForecastView>
  howItWorksView(): Promise<HowItWorksView>
  /** The Inputs screen, whole, as its URL asks; only the query step shown is built. */
  inputsScreen(opening?: InputsOpening): Promise<InputsScreen>
  /** A form saved, and where next; refused, with the whole screen to show again; or asking to confirm a clear. */
  submit(edit: Edit, opening?: SubmitOpening): Promise<Outcome>
  searchedChoiceList(kind: ChoiceKind, find: string, stepQuery: StepQuery): Promise<ChoiceList | undefined>
  openCandidates(): Promise<CandidateOpening>
}

/** Seam B: the team's handle, adding the default team on first launch, when nothing is stored yet. */
export function openForecasting(options: ForecastingOptions): Forecasting {
  const entries = openTeamEntries(options)
  return {
    connects: options.connecting !== undefined,
    milestoneForecastView: (shown) => entries().milestoneForecastView(shown),
    howItWorksView: () => entries().howItWorksView(),
    inputsScreen: (opening = {}) => inputsScreen(entries(), opening),
    submit: (edit, opening = {}) => submit(entries(), edit, opening),
    searchedChoiceList: (kind, find, stepQuery) => entries().searchedChoiceList(kind, find, stepQuery),
    openCandidates: () => entries().openCandidates(),
  }
}
