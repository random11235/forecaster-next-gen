import type { ChoiceKind } from '../../model/choice.js'
import { openCandidates, type CandidateOpening } from './candidates.js'
import { howItWorksView, type HowItWorksView } from './howItWorksView.js'
import { inputsScreen, type InputsOpening, type InputsScreen } from './inputsScreenView.js'
import { milestoneForecastView, type MilestoneForecastView } from './milestoneForecastView.js'
import { searchedChoiceList, type ChoiceList } from './queryStep.js'
import type { StepQuery } from './stepQuery.js'
import { submit, type Edit, type Outcome, type SubmitOpening } from './submit.js'
import { connected, openTeamCalls, type CapacityShown, type ForecastingOptions } from './teamCall.js'

export type { Clock, CapacityShown, ForecastingOptions } from './teamCall.js'
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

/**
 * Seam B: the team's handle, adding the default team on first launch, when nothing is stored yet. Each call reads the
 * clock once, and asks the tracker for the milestone choices once (`openTeamCalls`).
 */
export function openForecasting(options: ForecastingOptions): Forecasting {
  const call = openTeamCalls(options)
  return {
    connects: options.connecting !== undefined,
    milestoneForecastView: async ({ capacityOpen = false } = {}) => {
      const { storage, teamId, settings, at, tracker } = call()
      return milestoneForecastView(storage, teamId, settings, at.today, { capacityOpen, tracker })
    },
    howItWorksView: async () => howItWorksView(call().settings),
    inputsScreen: (opening = {}) => inputsScreen(call(), opening),
    submit: (edit, opening = {}) => submit(call(), edit, opening),
    searchedChoiceList: async (kind, find, stepQuery) => {
      const { reading, teamId } = call()
      return reading && searchedChoiceList(reading, teamId, kind, find, stepQuery)
    },
    openCandidates: async () => {
      const team = call()
      return openCandidates(connected(team), team.storage, team.teamId, team.at)
    },
  }
}
