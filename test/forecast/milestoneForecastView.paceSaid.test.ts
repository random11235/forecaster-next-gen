import { describe, expect, test } from 'vitest'
import { newTeam, edit, enter, view } from './forecastViewScenario.js'

// Seam B: how the Milestone forecast view says the pace it forecast from. Arranged through forecastViewScenario.ts;
// the dates and finish graph are milestoneForecastView.test.ts's, the pace's inputs milestoneForecastView.pace.test.ts's.

describe('the pace the forecast says it used', () => {
  test.each([
    ['7', 'typed counts, 6 weeks'],
    ['14', 'typed counts, 6 sprints'],
  ])('typed counts in use are said in the cadence’s periods: at %s days, “%s”', async (cadenceDays, said) => {
    const team = await newTeam()
    await enter(team, { startDate: '2026-09-01', ticketsRemaining: '100' }, { low: '4', high: '8' })
    expect(await edit(team, { kind: 'setCadence', cadenceDays })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceCounts', counts: '6, 4, 9, 7, 5, 8' })).toEqual({ ok: true })
    expect(await edit(team, { kind: 'setPaceMode', paceMode: 'counts' })).toEqual({ ok: true })

    expect(await view(team)).toMatchObject({ kind: 'forecast', paceSaid: said })
  })
})
