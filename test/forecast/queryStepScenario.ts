import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import type { Outcome, QuerySetupStep, QueryStep, StepQueryEdit } from '../../src/forecast/index.js'
import { forecastingForTest, TEAM, type ForecastingForTest } from './forecastingForTest.js'

// The arrangement shared by the query steps' tests (#191): the team's handle, connected, with setup open on its steps,
// as the EM picks the queries in them; the canned connector's choices and reads, and the means to change and open a
// step. What the steps pick is held in the setup draft, read here as `current(team)`.

export { TEAM }

export const payments: Choice = { kind: 'milestone', name: 'Payments v2', query: 'milestone:"Payments v2"' }
export const checkout: Choice = { kind: 'milestone', name: 'Checkout', query: 'milestone:"Checkout"' }
export const repay: Choice = { kind: 'label', name: 'repayments', query: 'label:"repayments"' }
export const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }

export const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [payments, checkout], pastLimit: false },
    { kind: 'label', choices: [repay, bug], pastLimit: false },
  ],
  reads: {
    'milestone:"Payments v2"': {
      tickets: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'p4', finishedAt: '2026-08-01T10:00:00Z' }],
      incomplete: false,
    },
    'milestone:"Payments v2" OR label:"bug"': {
      tickets: [{ id: 'p1' }, { id: 'p2' }, { id: 'b1' }, { id: 'p3', finishedAt: '2026-10-20T10:00:00Z' }, { id: 'b2', finishedAt: '2026-11-01T10:00:00Z' }],
      incomplete: false,
    },
    'label:checkout -label:bug': { tickets: [{ id: 'c1' }], incomplete: false },
  },
}

/** Connected to the GitHub repo shop-team/shop, setup open on its steps, with no calls counted yet. */
export function connected(fixture: CannedFixture = FIXTURE): Promise<ForecastingForTest> {
  return forecastingForTest({ fixture, connected: 'github', setupOpen: true })
}

/** Connected to the Jira project SHOP, setup open on its steps, with no calls counted yet. */
export function connectedToJira(fixture: CannedFixture): Promise<ForecastingForTest> {
  return forecastingForTest({ fixture, connected: 'jira', setupOpen: true })
}

/** The team's queries as the steps have them: the setup draft's over what's saved. */
export const current = (team: ForecastingForTest) => team.storage.teamQueries('current').milestoneQueries

/**
 * The milestone given a query in the steps, Checkout's, as the Milestone step leaves it, asking the tracker nothing: the
 * Comparable work step opens once the milestone has one.
 */
export function onComparableWork(team: ForecastingForTest): void {
  current(team).saveMilestoneQuery(TEAM, { picks: [checkout], query: checkout.query })
}

/** Submits `edit` in the query step `step`, the Milestone step unless given. */
export const change = (team: ForecastingForTest, edit: StepQueryEdit, step: QuerySetupStep = 'milestone'): Promise<Outcome> =>
  team.submit({ form: 'stepQuery', step, edit })

/** Where a change saved, or read as nothing new, goes: the step it was made in. */
export const saved = (step: QuerySetupStep = 'milestone'): Outcome => ({ saved: true, next: { screen: 'inputs', step } })

/** The query step `step` (the Milestone step unless given), as the Inputs screen opens at it, its find box holding `find`. */
export async function stepView(
  team: ForecastingForTest,
  find = '',
  { editing = false, confirmingBack = false } = {},
  step: QuerySetupStep = 'milestone',
): Promise<QueryStep> {
  const screen = await team.inputsScreen({
    step,
    find: step === 'milestone' ? { milestone: find } : { comparableWork: find },
    ...(editing && { editing: step }),
    ...(confirmingBack && { confirmingBack: true }),
  })
  if (!screen.step) throw new Error(`no query step shown: setup is ${JSON.stringify(screen.setup)}`)
  return screen.step
}

/** The query step a refused change shows again, on its refusal. */
export function refusedStep(outcome: Outcome): QueryStep {
  if (outcome.saved || !('screen' in outcome) || outcome.screen !== 'inputs' || !outcome.view.step) {
    throw new Error(`not refused at a query step: ${JSON.stringify(outcome)}`)
  }
  return outcome.view.step
}

/** A refused query, as its step shows it again: as typed, if edited by hand, and why. */
export function refusalOf(outcome: Outcome): { query?: string; refusal: string | undefined } {
  const { editing, refusal } = refusedStep(outcome)
  return editing ? { query: editing.typed, refusal: editing.refusal } : { refusal }
}

export const add = (choice: Choice) => ({ kind: 'addPick', choice }) as const
export const remove = (choice: Choice) => ({ kind: 'removePick', query: choice.query }) as const
export const edit = (query: string) => ({ kind: 'editQuery', query }) as const
export const back = { kind: 'backToFinding', confirmed: false } as const
export const backConfirmed = { kind: 'backToFinding', confirmed: true } as const

/** `FIXTURE`, its read of `query` answering `read`. */
export function reading(query: string, read: CannedFixture['reads'][string]): CannedFixture {
  return { ...FIXTURE, reads: { ...FIXTURE.reads, [query]: read } }
}
