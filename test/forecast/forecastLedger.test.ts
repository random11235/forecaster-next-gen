import { describe, expect, test } from 'vitest'
import { APP_VERSION } from '../../src/forecast/appVersion.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { TEAM, newTeam, mediumGrowth, enter, view } from './forecastViewScenario.js'

// Seam B: the forecast ledger (#27). Each forecast the Milestone forecast screen shows is logged in the ledger, which
// goes in through storage, with its case, the case's hash, its result, when it was logged and the release that made it.

/** An ISO instant, as the ledger stamps each forecast it logs. */
const isoInstant = (value: string) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/.test(value)

describe('logging each forecast', () => {
  test('a forecast shown is logged with its case, the case hash, its result, when it was logged and the release that made it', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    const before = new Date().toISOString()

    const shown = view(storage)

    const after = new Date().toISOString()
    expect(shown).toMatchObject({ kind: 'forecast' })
    const logs = storage.forecastLogs(TEAM)
    expect(logs).toEqual([
      {
        id: 1,
        teamId: TEAM,
        createdAt: expect.any(String),
        milestoneName: 'Checkout v2',
        caseHash: expect.stringMatching(/^[0-9a-f]{16}$/),
        appVersion: APP_VERSION,
        simulationCase: {
          engineVersion: '2',
          seed: DEFAULT_SETTINGS.seed,
          trials: DEFAULT_SETTINGS.trials,
          maxPeriods: 156,
          question: { kind: 'when' },
          startDate: '2026-09-01',
          periodDays: 7,
          scope: [{ epicId: TEAM, rank: 1, baseCount: 10, currentCount: 10, doneCount: 0, growth: { low: 1, high: 1 } }],
          throughputSamples: { low: 5, high: 5 },
          epicSizeSamples: { low: 0, high: 0 },
          percentiles: [50, 70, 85, 95],
        },
        result: expect.objectContaining({
          percentileDates: { 50: '2026-09-15', 70: '2026-09-15', 85: '2026-09-15', 95: '2026-09-15' },
          finishCounts: [0, 0, DEFAULT_SETTINGS.trials],
          finishedFraction: 1,
        }),
      },
    ])
    const [log] = logs
    expect(log?.result.caseHash).toBe(log?.caseHash)
    expect(isoInstant(log?.createdAt ?? '')).toBe(true)
    expect(log && log.createdAt >= before && log.createdAt <= after).toBe(true)
  })
})
