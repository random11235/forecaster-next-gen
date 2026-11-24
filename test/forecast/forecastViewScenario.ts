import { expect } from 'vitest'
import { DEFAULT_SETTINGS, type Forecasting, type InputsEdit } from '../../src/forecast/index.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import { forecastingForTest, submitInputs, TEAM, type ForecastingForTest } from './forecastingForTest.js'

// The arrangement the Milestone forecast view's tests (milestoneForecastView.test.ts and the
// milestoneForecastView.*.test.ts beside it) share: the team's handle, as the browser build opens it, on today, and the
// means to enter inputs and read the views.

export { TEAM }
/** Today, fixed: before every start date these tests enter, unless a test says the start date is past. */
export const TODAY = '2026-08-24'

/** The team's handle with nothing entered yet, on `today` unless `TODAY`, with `settings` unless the defaults. */
export function newTeam(settings = DEFAULT_SETTINGS, today = TODAY): Promise<ForecastingForTest> {
  return forecastingForTest({ browser: true, clock: { now: `${today}T09:00:00Z` }, settings })
}

/**
 * Submits a form on the Inputs screen: saved; or refused, with the Inputs screen's error, on the Milestone forecast
 * screen, or where it leads (`next`); or held for the EM to confirm clearing.
 */
export async function edit(team: Pick<Forecasting, 'submit'>, change: InputsEdit) {
  const submitted = await submitInputs(team, change)
  switch (submitted.kind) {
    case 'saved':
    case 'savedInPlace':
      return { ok: true }
    case 'refused':
      return { ok: false, error: submitted.view.inputs.refusal?.error }
    case 'refusedOnForecast':
      return { ok: false, screen: 'forecast' as const }
    case 'refusedThere':
      return { ok: false, next: submitted.next }
    case 'confirmClear':
      return { ok: false, confirm: true }
  }
}

/**
 * Checkout v2 as a release before the MVP kept it, saved straight into storage: no start date, tickets remaining or
 * pace, unless `kept` gives them, for what no Inputs form can leave unentered.
 */
export function keptFromBeforeTheMvp(team: ForecastingForTest, kept: Partial<MilestoneInputs> = {}): void {
  team.storage.saveMilestoneInputs({
    teamId: TEAM,
    name: 'Checkout v2',
    startDate: undefined,
    ticketsRemaining: undefined,
    ambiguity: 'medium',
    cadenceDays: 7,
    paceMode: 'range',
    paceRange: undefined,
    paceCounts: [],
    paceCadenceDays: undefined,
    paceWindow: { action: undefined, skippedPeriods: [] },
    ticketsSource: 'typed',
    seenReads: { ticketsRemaining: undefined, pace: undefined },
    ...kept,
  })
}

/** The EM enters the milestone and a pace range, as the Inputs screen does. */
export async function enter(
  team: Pick<Forecasting, 'submit'>,
  milestone: { startDate: string; ticketsRemaining: string },
  pace: { low: string; high: string },
): Promise<void> {
  expect(await edit(team, { kind: 'setMilestone', name: 'Checkout v2', ...milestone })).toEqual({ ok: true })
  expect(await edit(team, { kind: 'setPaceRange', ...pace })).toEqual({ ok: true })
}

/** 100 tickets at 4–8 a week, growing 1–2×, from 1 Sep 2026: the engine's dates for the fixed seed. */
export const DATES_FROM_1_SEP = [
  { percent: 50, date: '2027-03-02' },
  { percent: 70, date: '2027-03-23' },
  { percent: 85, date: '2027-04-06' },
  { percent: 95, date: '2027-04-20' },
]

/** The same forecast started two weeks later: every date two weeks later. */
export const DATES_FROM_15_SEP = [
  { percent: 50, date: '2027-03-16' },
  { percent: 70, date: '2027-04-06' },
  { percent: 85, date: '2027-04-20' },
  { percent: 95, date: '2027-05-04' },
]

export function view(team: ForecastingForTest) {
  return team.milestoneForecastView()
}

export async function inputsScreenView(team: ForecastingForTest) {
  return (await team.inputsScreen()).inputs
}
