import { describe, expect, test } from 'vitest'
import { openForecasting } from '../../src/forecast/index.js'
import { open, schemaOf, versionOf, writeFile } from './migrationsHarness.js'
import { TEAM, VERSION_21_SCHEMA } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

const TODAY = { now: () => '2026-09-01T09:00:00Z', timeZone: 'UTC' }

describe('step 22: a data file from schema version 21, with the cadence its pace was entered in', () => {
  test('drops the pace’s own cadence: the pace is read in the milestone’s cadence, with no warning, and survives reopening', async () => {
    // entered weekly, then the cadence changed to 3-day sprints
    const file = writeFile('v21.db', `${VERSION_21_SCHEMA}\nUPDATE milestone_inputs SET cadence_days = 3, pace_cadence_days = 7 WHERE team_id = '${TEAM}';`, 21)

    expect(open(file).milestoneInputs(TEAM)).toMatchObject({ cadenceDays: 3, paceRange: { low: 4, high: 8 }, paceCounts: [6, 9] })
    expect(open(file).milestoneInputs(TEAM)).not.toHaveProperty('paceCadenceDays')
    expect(await openForecasting({ storage: open(file), clock: TODAY }).milestoneForecastView()).toMatchObject({
      kind: 'forecast',
      cadenceDays: 3,
      pace: { source: 'range', low: 4, high: 8 },
      warnings: [],
    })
    expect(versionOf(file)).toBe(22)
    expect(JSON.stringify(schemaOf(file))).not.toContain('pace_cadence_days')
  })
})
