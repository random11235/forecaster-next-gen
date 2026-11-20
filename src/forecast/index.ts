// The forecast module's one entry point: the team's handle (`openForecasting`), what goes in through it, each view and
// edit the screens show and post, and the limits the screens' fields are given. Everything else is private, in lib/.

export { openForecasting, type Forecasting } from './forecasting.js'
export type {
  CapacityShown,
  Clock,
  Edit,
  ForecastingOptions,
  InputsOpening,
  InputsScreen,
  Outcome,
  Place,
  QuerySetupStep,
  SubmitOpening,
} from './forecasting.js'
export type { Connecting, ConnectionEdit, ConnectStep } from './connection.js'
export { DEFAULT_SETTINGS, type ForecastSettings } from './settings.js'
export { APP_VERSION } from './appVersion.js'

// The limits each field is given: the screens' inputs say them, and the forms are refused past them.
export { MAX_CADENCE_DAYS, MAX_TICKETS_PER_PERIOD, MAX_TICKETS_REMAINING } from './milestoneInputs.js'
export { MAX_GROWTH } from './growth.js'
export { MAX_CAPACITY_PERCENT } from './capacity.js'

// The setup's steps and the two queries they edit, and how few candidates are read without asking.
export { SETUP_STEPS, type SetupStep } from './setupSteps.js'
export { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from './stepQuery.js'
export { FEW_CANDIDATES } from './candidates.js'

// The views and edits the screens show and post.
export type { PeriodName } from './cadence.js'
export type { Candidate, CandidateGroupKind, CandidateOpening, Candidates } from './candidates.js'
export type { CapacityEdit, CapacityEntryView, CapacityForm, CapacityView, EntryEffect } from './capacity.js'
export type { ComparableWorkPace, PairedPeriod, PickPace } from './comparableWorkPace.js'
export type { GrowthView, TypedRange } from './growth.js'
export type { HowItWorksView } from './howItWorksView.js'
export type { InputsEdit, InputsForm, InputsView, NextScreen, TypedForms } from './inputs.js'
export type { InputNote, MilestoneInput } from './milestoneAssessment.js'
export type { ComparedDate, FinishBar, ForecastDate, MilestoneForecastView } from './milestoneForecastView.js'
export type { MilestoneInputsView, ReadsDifferently, TicketsSourceView, TrackerPaceView } from './milestoneInputs.js'
export type { PaceActionEdit, PacePatternView, PatternAction } from './pacePattern.js'
export type { PaceTrend, PairedPace } from './paceTrend.js'
export type { PaceVersus } from './paceVersusOwn.js'
export type { ChoiceList, QueryEditing, QueryStep, StepQueryEdit } from './queryStep.js'
export type { PaceCheck, SetupCheck, SetupEdit, SetupSteps, TicketsCheck } from './setup.js'
export type { SetupSummary, SummaryFlag, SummaryRow } from './setupSummary.js'
export type { SkipEdit } from './skippedPeriods.js'
export type { Tracker } from './trackers.js'
