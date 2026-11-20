import type { InputsEdit, MilestoneForecastView, Outcome } from '../../src/forecast/index.js'
import { forecastingForTest, TEAM, type ForecastingForTest } from './forecastingForTest.js'

// The arrangement capacity.test.ts and capacity.entries.test.ts share: the team's handle, as the browser build opens
// it, on today, the milestone entered, and the means to type capacity and read the forecast.

export { TEAM }
export const TODAY = '2026-08-24'
/** A Monday, so each week from it runs Monday to Sunday. */
export const MONDAY = '2026-09-07'

/** The team's handle with nothing entered yet, on `TODAY`. */
export function newTeam(): Promise<ForecastingForTest> {
  return forecastingForTest({ browser: true, clock: { now: `${TODAY}T09:00:00Z` } })
}

/** 10 tickets at exactly 5 a week, growing 1×, from Monday 7 Sep: with usual capacity, done on 21 Sep. */
export async function tenTicketsAtFive(team: ForecastingForTest, { cadenceDays = '7', pace = '5' } = {}): Promise<void> {
  team.storage.saveAmbiguityRanges({ teamId: TEAM, low: { low: 1, high: 1 }, medium: { low: 1, high: 1 }, high: { low: 1, high: 1 } })
  await submit(team, { kind: 'setMilestone', name: 'Launch', startDate: MONDAY, ticketsRemaining: '10' })
  await submit(team, { kind: 'setCadence', cadenceDays })
  await submit(team, { kind: 'setPaceRange', low: pace, high: pace })
}

export function submit(team: ForecastingForTest, edit: InputsEdit, { capacityOpen = false } = {}): Promise<Outcome> {
  return team.submit({ form: 'inputs', edit }, { capacityOpen })
}

/** The EM types capacity as one sentence: "The team is at {percent}% from {from} to {to}, or onward, for {note}." */
export function add(team: ForecastingForTest, percent: string, from: string, to: string, { onward = false, note = '' } = {}): Promise<Outcome> {
  return submit(team, { kind: 'addCapacity', percent, from, to, onward, note })
}

export function view(team: ForecastingForTest): Promise<MilestoneForecastView> {
  return team.milestoneForecastView()
}

/** The 85% date the headline gives. */
export async function headline(team: ForecastingForTest): Promise<string | null | undefined> {
  const forecast = await view(team)
  return forecast.kind === 'forecast' ? forecast.dates.find(({ percent }) => percent === 85)?.date : undefined
}

/** The screen a refused submit shows again. */
export function refusedOn(result: Outcome): 'inputs' | 'forecast' | undefined {
  return !result.saved && 'screen' in result ? result.screen : undefined
}

/** The forecast a submit refused on the forecast screen shows again. */
export function shownAgain(result: Outcome): MilestoneForecastView | undefined {
  return !result.saved && 'screen' in result && result.screen === 'forecast' ? result.view : undefined
}

/** The forecast, less its Capacity section. */
export function withoutCapacity(forecast: MilestoneForecastView) {
  if (forecast.kind !== 'forecast') return forecast
  const { capacity: _, ...rest } = forecast
  return rest
}
