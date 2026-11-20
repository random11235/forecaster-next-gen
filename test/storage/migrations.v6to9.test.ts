import { describe, expect, test } from 'vitest'
import { openForecasting, type Forecasting } from '../../src/forecast/index.js'
import type { Storage } from '../../src/storage/storage.js'
import { writeFile, open } from './migrationsHarness.js'
import { TEAM, VERSION_6_SCHEMA, VERSION_7_SCHEMA, VERSION_8_SCHEMA, VERSION_9_SCHEMA } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

/** The team's handle on the migrated file, as the browser build opens it, on `today`: the forecast reads it back. */
const forecasting = (storage: Storage, today: string): Forecasting => openForecasting({ storage, clock: { now: () => `${today}T09:00:00Z`, timeZone: 'UTC' } })

describe('step 7: a data file from schema version 6, before milestone inputs', () => {
  test("keeps each team's first milestone by name and manual pace, and leaves its start date and tickets to enter", () => {
    const file = writeFile('v6.db', VERSION_6_SCHEMA, 6)

    const storage = open(file)

    const defaults = {
      ambiguity: 'medium',
      cadenceDays: 7,
      paceMode: 'range',
      paceCounts: [],
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    }
    const left = { startDate: undefined, ticketsRemaining: undefined }
    expect(storage.milestoneInputs(TEAM)).toEqual({
      teamId: TEAM,
      name: 'Launch',
      ...left,
      ...defaults,
      paceRange: { low: 3, high: 7 },
      paceCadenceDays: 7,
      paceWindow: { action: undefined, skippedPeriods: [] },
    })
    expect(storage.milestoneInputs('sample-team')).toEqual({
      teamId: 'sample-team',
      name: 'Checkout v2',
      ...left,
      ...defaults,
      paceRange: undefined,
      paceCadenceDays: undefined,
      paceWindow: { action: undefined, skippedPeriods: [] },
    })
  })

  test('is forecast from its MVP fields once its start date and tickets are entered: its name and pace, not its epics', async () => {
    const storage = open(writeFile('v6.db', VERSION_6_SCHEMA, 6))

    const entered = await forecasting(storage, '2026-09-01').submit({
      form: 'inputs',
      edit: {
        kind: 'setMilestone',
        name: 'Launch',
        startDate: '2026-09-01',
        ticketsRemaining: '20',
      },
    })

    expect(entered).toEqual({ kind: 'saved', next: { screen: 'inputs' } })
    expect(await forecasting(storage, '2026-09-01').milestoneForecastView()).toMatchObject({
      kind: 'forecast',
      name: 'Launch',
      ticketsRemaining: 20,
      startDate: '2026-09-01',
      pace: { source: 'range', low: 3, high: 7 },
    })
  })

  test('takes the milestone inputs, and they survive reopening', () => {
    const file = writeFile('v6.db', VERSION_6_SCHEMA, 6)
    const inputs = {
      teamId: TEAM,
      name: 'Launch',
      startDate: '2026-09-01',
      ticketsRemaining: 120,
      ticketsSource: 'typed' as const,
      ambiguity: 'high' as const,
      cadenceDays: 14,
      paceMode: 'counts' as const,
      paceRange: { low: 4, high: 8 },
      paceCounts: [6, 0, 9],
      paceCadenceDays: 7,
      paceWindow: { action: undefined, skippedPeriods: [] },
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    }

    open(file).saveMilestoneInputs(inputs)

    expect(open(file).milestoneInputs(TEAM)).toEqual(inputs)
  })
})

describe('step 8: a data file from schema version 7, before the cadence the pace was entered in', () => {
  test('counts a pace already saved as entered in its cadence, so it forecasts with no warning', async () => {
    const storage = open(writeFile('v7.db', VERSION_7_SCHEMA, 7))

    expect(storage.milestoneInputs(TEAM)).toMatchObject({ cadenceDays: 14, paceCadenceDays: 14 })
    expect(await forecasting(storage, '2026-09-01').milestoneForecastView()).toMatchObject({ kind: 'forecast', warnings: [] })
  })

  test('leaves a milestone with no pace yet without one', () => {
    const storage = open(writeFile('v7.db', VERSION_7_SCHEMA, 7))

    expect(storage.milestoneInputs('sample-team')).toMatchObject({ paceRange: undefined, paceCounts: [], paceCadenceDays: undefined })
  })

  test('warns once the cadence changes after the upgrade', async () => {
    const storage = open(writeFile('v7.db', VERSION_7_SCHEMA, 7))

    await forecasting(storage, '2026-09-01').submit({ form: 'inputs', edit: { kind: 'setCadence', cadenceDays: '7' } })

    expect(await forecasting(storage, '2026-09-01').milestoneForecastView()).toMatchObject({
      warnings: [{ input: 'pace', message: 'Pace: cadence length has changed. Please verify that the per period numbers are aligned.' }],
    })
  })
})

describe('step 9: a data file from schema version 8, before capacity', () => {
  test('has no capacity entries, forecasts as before, and takes entries that survive reopening', async () => {
    const file = writeFile('v8.db', VERSION_8_SCHEMA, 8)
    const storage = open(file)
    expect(storage.capacityEntries(TEAM)).toEqual([])
    expect(await forecasting(storage, '2026-09-01').milestoneForecastView()).toMatchObject({ kind: 'forecast', warnings: [] })

    const holiday = { id: 1, from: '2026-09-07', to: '2026-09-07', percent: 0, note: 'Holiday' }
    storage.saveCapacityEntries(TEAM, [holiday])

    expect(open(file).capacityEntries(TEAM)).toEqual([holiday])
  })
})

describe('step 10: a data file from schema version 9, before the capacity switch', () => {
  test('keeps its capacity entries, has capacity on, and takes the switch, which survives reopening', () => {
    const file = writeFile('v9.db', VERSION_9_SCHEMA, 9)
    const storage = open(file)
    expect(storage.capacityEntries(TEAM)).toEqual([{ id: 1, from: '2026-09-07', to: '2026-09-07', percent: 0, note: 'Holiday' }])
    expect(storage.capacityOn(TEAM)).toBe(true)

    storage.saveCapacityOn(TEAM, false)

    expect(open(file).capacityOn(TEAM)).toBe(false)
  })
})
