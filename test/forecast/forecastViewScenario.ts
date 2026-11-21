import { expect } from 'vitest'
import { DEFAULT_SETTINGS, type InputsEdit } from '../../src/forecast/index.js'
import type { GrowthRange } from '../../src/model/ambiguity.js'
import { forecastingForTest, TEAM, type ForecastingForTest } from './forecastingForTest.js'

// The arrangement the Milestone forecast view's tests (milestoneForecastView.test.ts and the
// milestoneForecastView.*.test.ts beside it) share: the team's handle, as the browser build opens it, on today, and the
// means to enter inputs and read the views.

export { TEAM }
/** Today, fixed: before every start date these tests enter, unless a test says the start date is past. */
export const TODAY = '2026-08-24'

/** The team's handle with nothing entered yet, on `TODAY`, with `settings` unless the defaults. */
export function newTeam(settings = DEFAULT_SETTINGS): Promise<ForecastingForTest> {
  return forecastingForTest({ browser: true, clock: { now: `${TODAY}T09:00:00Z` }, settings })
}

/** Sets the team's medium growth range: the growth of a milestone of medium ambiguity, the default. */
export function mediumGrowth(team: ForecastingForTest, medium: GrowthRange): void {
  team.storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1.5 }, medium, high: { low: 1.5, high: 3 } })
}

export function submit(team: ForecastingForTest, change: InputsEdit) {
  return team.submit({ form: 'inputs', edit: change })
}

/** Submits a form on the Inputs screen: saved, or why it was refused there. */
export async function edit(team: ForecastingForTest, change: InputsEdit) {
  const submitted = await submit(team, change)
  if (submitted.saved) return { ok: true }
  if ('confirmClear' in submitted) return { ok: false }
  return submitted.screen === 'inputs' ? { ok: false, error: submitted.view.inputs.refusal?.error } : { ok: false, screen: submitted.screen }
}

/** The EM enters the milestone and a pace range, as the Inputs screen does. */
export async function enter(
  team: ForecastingForTest,
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
