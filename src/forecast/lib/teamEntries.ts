import type { Connector } from '../../connectors/connector.js'
import type { ChoiceKind } from '../../model/choice.js'
import type { Team } from '../../model/team.js'
import type { Storage } from '../../storage/storage.js'
import { openCandidates, type CandidateOpening } from './candidates.js'
import { connectionView, submitConnection, type Connecting, type ConnectionEdit, type ConnectionSubmitted, type ConnectionView } from './connection.js'
import { howItWorksView, type HowItWorksView } from './howItWorksView.js'
import { inputsView, submitInputs, type InputsEdit, type InputsView, type Submitted } from './inputs.js'
import { calendarDayIn } from './pace.js'
import { milestoneForecastView, type MilestoneForecastView } from './milestoneForecastView.js'
import { followRenamedMilestone } from './milestoneRenamed.js'
import {
  queryStepView,
  searchedChoiceList,
  submitStepQuery,
  type ChoiceList,
  type QueryStepOpening,
  type QueryStepView,
  type StepQueryEdit,
  type StepQuerySubmitted,
} from './queryStep.js'
import { DEFAULT_SETTINGS, type ForecastSettings } from './settings.js'
import { openSetup, submitSetup, type SetupContext, type SetupEdit, type SetupOpening, type SetupSubmitted, type SetupView } from './setup.js'
import { submitReadAgain, type ReadAgainSubmitted } from './setupReads.js'
import { submitSkip, type SkipEdit, type Skipping } from './skippedPeriods.js'
import type { StepQuery } from './stepQuery.js'
import type { TrackerReads } from './trackerReads.js'

/** The time, as the EM's computer tells it: the UTC instant now, and the EM's time zone (an IANA name). */
export interface Clock {
  now(): string
  timeZone: string
}

/**
 * What the team's handle is opened on: where everything is stored, the clock, the settings (`DEFAULT_SETTINGS` unless
 * given), and, in the local server build, what it connects a tracker with; the browser build connects nothing, so its
 * views have no Connect or query step.
 */
export interface ForecastingOptions {
  storage: Storage
  connecting?: Connecting
  clock: Clock
  settings?: ForecastSettings
}

/** Whether the Milestone forecast screen opens with its Capacity section open, where each entry gives its own effect. */
export interface CapacityShown {
  capacityOpen?: boolean
}

/**
 * Seam B's entry points, bound to the team, the clock and what the handle was opened on, on today, the clock's date in
 * the EM's time zone: what the handle (`Forecasting`) builds its views and submits from. The steps and their submits
 * need what the local server build connects with: without it, the views have none, and a submit of one is refused by
 * throwing, as the browser build never sends one.
 */
export interface TeamEntries {
  /** The milestone's name, as entered so far; none (`''`) until it is. */
  milestoneName(): string
  milestoneForecastView(shown?: CapacityShown): Promise<MilestoneForecastView>
  howItWorksView(): Promise<HowItWorksView>
  inputsView(): Promise<InputsView>
  submitInputs(edit: InputsEdit, shown?: CapacityShown): Promise<Submitted>
  submitSkip(edit: SkipEdit): Promise<Submitted>
  connectionView(): Promise<ConnectionView>
  submitConnection(edit: ConnectionEdit): Promise<ConnectionSubmitted>
  openSetup(opening: SetupOpening): Promise<SetupView>
  submitSetup(edit: SetupEdit): Promise<SetupSubmitted>
  submitReadAgain(): Promise<ReadAgainSubmitted>
  queryStepView(find: string, opening: QueryStepOpening, stepQuery: StepQuery): Promise<QueryStepView>
  searchedChoiceList(kind: ChoiceKind, find: string, stepQuery: StepQuery): Promise<ChoiceList | undefined>
  submitStepQuery(edit: StepQueryEdit, stepQuery: StepQuery): Promise<StepQuerySubmitted>
  openCandidates(): Promise<CandidateOpening>
  /** Unchanged with nothing connected, which has no milestone query to follow. */
  followRenamedMilestone(renamed: { from: string; to: string }): Promise<StepQuerySubmitted>
}

/**
 * Seam B's entry points for the team, adding the default team on first launch, when nothing is stored yet: fresh for
 * each call of the handle, whose entry points ask the tracker for the milestone choices once between them.
 */
export function openTeamEntries({ storage, connecting, clock, settings = DEFAULT_SETTINGS }: ForecastingOptions): () => TeamEntries {
  const teamId = (storage.teams()[0] ?? addDefaultTeam(storage, clock.now())).id
  const { timeZone } = clock
  const today = (): string => calendarDayIn(timeZone)(clock.now())
  const tracker: TrackerReads | undefined = connecting && { ...connecting, timeZone }
  return () => teamEntries({ storage, ...(connecting && { connecting: listingOnce(connecting) }), clock, settings }, teamId, today, tracker)
}

/** The team's entry points, on what `connecting` lists, which a handle's call shares between them. */
function teamEntries(
  { storage, connecting, clock, settings }: Required<Omit<ForecastingOptions, 'connecting'>> & Pick<ForecastingOptions, 'connecting'>,
  teamId: string,
  today: () => string,
  tracker: TrackerReads | undefined,
): TeamEntries {
  const { timeZone } = clock
  /** What setup and its steps read and save with. */
  const reading = (): (SetupContext & Skipping) | undefined => connecting && { ...connecting, milestoneInputs: storage, today: today(), timeZone }
  const connected = (): SetupContext & Skipping => {
    const context = reading()
    if (!context) throw new Error('The browser build connects no tracker.')
    return context
  }
  return {
    milestoneName: () => storage.milestoneInputs(teamId)?.name ?? '',
    milestoneForecastView: async ({ capacityOpen = false } = {}) => milestoneForecastView(storage, teamId, settings, today(), { capacityOpen, tracker }),
    howItWorksView: async () => howItWorksView(settings),
    inputsView: async () => inputsView(storage, teamId, settings, today(), { tracker }),
    submitInputs: async (edit, { capacityOpen = false } = {}) => submitInputs(storage, teamId, settings, today(), edit, { capacityOpen, tracker }),
    submitSkip: async (edit) => submitSkip(connected(), teamId, edit, { settings, today: today(), readAt: clock.now(), timeZone }),
    connectionView: async () => connectionView(connecting, teamId),
    submitConnection: async (edit) => submitConnection(connected(), teamId, edit),
    openSetup: async (opening) => openSetup(reading(), teamId, opening, clock.now()),
    submitSetup: async (edit) => submitSetup(connected(), teamId, edit),
    submitReadAgain: async () => submitReadAgain(connected(), teamId, clock.now()),
    queryStepView: async (find, opening, stepQuery) => {
      const stepping = reading()
      return queryStepView(stepping && { ...stepping, at: { readAt: clock.now(), today: stepping.today, timeZone } }, teamId, find, opening, stepQuery)
    },
    searchedChoiceList: async (kind, find, stepQuery) => {
      const context = reading()
      return context && searchedChoiceList(context, teamId, kind, find, stepQuery)
    },
    submitStepQuery: async (edit, stepQuery) => submitStepQuery(connected(), teamId, edit, clock.now(), stepQuery),
    openCandidates: async () => openCandidates(connected(), storage, teamId, { readAt: clock.now(), today: today(), timeZone }),
    followRenamedMilestone: async (renamed) => {
      const context = reading()
      return context ? followRenamedMilestone(context, teamId, renamed, clock.now()) : { kind: 'unchanged' }
    },
  }
}

/**
 * Adds the one team everything is stored under, installed at `installedAt`. The MVP has no team screen, so the EM never
 * sees it: its facts are the ones the EM types in, read from no board or repository.
 */
function addDefaultTeam(storage: Storage, installedAt: string): Team {
  const team: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt }
  storage.saveTeam(team)
  return team
}

/** `connecting`, but its connectors ask the tracker for the milestone choices once between them, however often asked. */
function listingOnce(connecting: Connecting): Connecting {
  let listed: ReturnType<Connector['milestoneChoices']> | undefined
  return {
    ...connecting,
    connector: (connection, token) => {
      const connector = connecting.connector(connection, token)
      return {
        milestoneChoices: () => (listed ??= connector.milestoneChoices()),
        searchChoices: (kind, text) => connector.searchChoices(kind, text),
        read: (query, finishedSince) => connector.read(query, finishedSince),
      }
    },
  }
}
