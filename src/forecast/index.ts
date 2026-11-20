// The forecast module's one entry point: the team's handle (`openForecasting`), what goes in through it, each view and
// edit the screens show and post, and the limits the screens' fields are given. Everything else is private, in lib/.

export { openForecasting, type Forecasting } from './lib/forecasting.js'
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
} from './lib/forecasting.js'
export type { Connecting, ConnectionEdit, ConnectStep } from './lib/connection.js'
export { DEFAULT_SETTINGS, type ForecastSettings } from './lib/settings.js'
export { APP_VERSION } from './lib/appVersion.js'
// What a logged forecast re-run comes to (the handle's `rerunForecast`).
export type { Rerun } from './lib/forecastLedger.js'

// The limits each field is given: the screens' inputs say them, and the forms are refused past them.
export { MAX_CADENCE_DAYS, MAX_TICKETS_PER_PERIOD, MAX_TICKETS_REMAINING } from './lib/milestoneInputs.js'
export { MAX_GROWTH } from './lib/growth.js'
export { MAX_CAPACITY_PERCENT } from './lib/capacity.js'

// The setup's steps and the two queries they edit, and how few candidates are read without asking.
export { SETUP_STEPS, type SetupStep } from './lib/setupSteps.js'
export { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from './lib/stepQuery.js'
export { FEW_CANDIDATES } from './lib/candidates.js'

// The views and edits the screens show and post.
export type { PeriodName } from './lib/cadence.js'
export type { Candidate, CandidateGroupKind, CandidateOpening, Candidates } from './lib/candidates.js'
export type { CapacityEdit, CapacityEntryView, CapacityForm, CapacityView, EntryEffect } from './lib/capacity.js'
export type { ComparableWorkPace, PairedPeriod, PickPace } from './lib/comparableWorkPace.js'
export type { GrowthView, TypedRange } from './lib/growth.js'
export type { HowItWorksView } from './lib/howItWorksView.js'
export type { InputsEdit, InputsForm, InputsView, NextScreen, TypedForms } from './lib/inputs.js'
export type { InputNote, MilestoneInput } from './lib/milestoneAssessment.js'
export type { ComparedDate, FinishBar, ForecastDate, MilestoneForecastView } from './lib/milestoneForecastView.js'
export type { MilestoneInputsView, ReadsDifferently, TicketsSourceView, TrackerPaceView } from './lib/milestoneInputs.js'
export type { PaceActionEdit, PacePatternView, PatternAction } from './lib/pacePattern.js'
export type { PaceTrend, PairedPace } from './lib/paceTrend.js'
export type { PaceVersus } from './lib/paceVersusOwn.js'
export type { ChoiceList, QueryEditing, QueryStep, StepQueryEdit } from './lib/queryStep.js'
export type { PaceCheck, SetupCheck, SetupEdit, SetupSteps, TicketsCheck } from './lib/setup.js'
export type { SetupSummary, SummaryFlag, SummaryRow } from './lib/setupSummary.js'
export type { SkipEdit } from './lib/skippedPeriods.js'
export type { Tracker } from './lib/trackers.js'

// A day as the views' lines say it (`12 Oct`), so the screens say the dates they draw the same way.
export { dayMonth } from './lib/calendarDate.js'
