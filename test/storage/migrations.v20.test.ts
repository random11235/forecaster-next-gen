import { describe, expect, test } from 'vitest'
import { writeFile, open, versionOf } from './migrationsHarness.js'
import { TEAM, VERSION_20_SCHEMA } from './pastSchemas.js'
import { FORECAST } from './storageContractFixtures.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

describe('step 21: a data file from schema version 20, before the forecast ledger', () => {
  test('has logged no forecast, and logs one, which survives reopening', () => {
    const file = writeFile('v20.db', VERSION_20_SCHEMA, 20)
    const logged = { ...FORECAST, teamId: TEAM }
    expect(open(file).forecastLogs(TEAM)).toEqual([])
    expect(open(file).lastForecastLog(TEAM)).toBeUndefined()

    open(file).saveForecastLog(logged)

    expect(open(file).forecastLogs(TEAM)).toEqual([{ ...logged, id: 1, createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/) }])
    expect(versionOf(file)).toBe(21)
  })
})
