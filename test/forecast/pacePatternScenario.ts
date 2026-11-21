import type { CannedFixture } from '../../src/connectors/canned.js'
import type { InputsEdit } from '../../src/forecast/index.js'
import { forecastingForTest, type ForecastingForTest } from './forecastingForTest.js'

// Pace patterns (#161): the tool reads the shape of the counts the Pace bars show and names it, with the team's
// numbers and never a cause, and where there's a forecast action it offers it with the 85% date both ways.
// The arrangement shared by the pacePattern.*.test.ts files: a milestone, its pace typed counts, on the team's handle.

/** A Wednesday, in the second week from the start date. */
export const TODAY = '2026-11-11'
/** 09:00 UTC on `TODAY`. */
export const NOW = `${TODAY}T09:00:00Z`
/**
 * A Monday. Typed counts are dated back from the current period (from 9 Nov), the last being the most recent whole
 * one: the week of 2 Nov. Ten counts are the weeks from 31 Aug to 2 Nov.
 */
export const START = '2026-11-02'

/** The team's handle on `TODAY`: as the browser build opens it, unless connecting on `fixture`. */
export const teamOn = (fixture?: CannedFixture): Promise<ForecastingForTest> =>
  forecastingForTest({ clock: { now: NOW }, ...(fixture ? { fixture, connected: true } : { browser: true }) })

export function submit(team: ForecastingForTest, edit: InputsEdit) {
  return team.submit({ form: 'inputs', edit })
}

/** 60 tickets from 2 Nov, its pace the typed counts, oldest first. */
export async function withTypedCounts(counts: readonly number[], cadenceDays = 7): Promise<ForecastingForTest> {
  const team = await teamOn()
  await submit(team, { kind: 'setMilestone', name: 'Launch', startDate: START, ticketsRemaining: '60' })
  if (cadenceDays !== 7) await submit(team, { kind: 'setCadence', cadenceDays: String(cadenceDays) })
  await submit(team, { kind: 'setPaceCounts', counts: counts.join(', ') })
  await submit(team, { kind: 'setPaceMode', paceMode: 'counts' })
  return team
}

export async function forecast(team: ForecastingForTest) {
  const view = await team.milestoneForecastView()
  if (view.kind !== 'forecast') throw new Error(`no forecast: ${view.kind}`)
  return view
}
