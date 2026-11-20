import { describe, expect, test } from 'vitest'
import { APP_VERSION } from '../../src/forecast/appVersion.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { rerunForecast } from '../../src/forecast/forecastLedger.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage } from '../../src/storage/webStorage.js'
import { ISO_INSTANT } from '../isoInstant.js'
import { memoryStore } from '../memoryStore.js'
import { TEAM, TODAY, newTeam, mediumGrowth, enter, openStorage, submit, view } from './forecastViewScenario.js'

// Seam B: the forecast ledger (#27). Each forecast the Milestone forecast screen shows is logged in the ledger, which
// goes in through storage, with its case, the case's hash, its result, when it was logged and the release that made it.

/** Each storage the ledger goes in through, on a new team: the app's SQLite file and the web build's browser storage. */
const storages: [string, () => { storage: Storage; reopen: () => Storage }][] = [
  ['SQLite', () => ({ storage: newTeam(), reopen: openStorage })],
  [
    'browser',
    () => {
      const store = memoryStore()
      return { storage: newTeam(openWebStorage(store)), reopen: () => openWebStorage(store) }
    },
  ],
]

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
          caseHash: expect.stringMatching(/^[0-9a-f]{16}$/),
          percentileDates: { 50: '2026-09-15', 70: '2026-09-15', 85: '2026-09-15', 95: '2026-09-15' },
          finishCounts: [0, 0, DEFAULT_SETTINGS.trials],
          finishedFraction: 1,
        }),
      },
    ])
    const [log] = logs
    expect(log?.createdAt).toMatch(ISO_INSTANT)
    expect(log && log.createdAt >= before && log.createdAt <= after).toBe(true)
  })
})

describe('logging each forecast once', () => {
  test('the same forecast shown again is not logged again, and one from changed inputs is logged after it', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    view(storage)
    view(storage)
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '20' }, { low: '5', high: '5' })
    view(storage)
    view(storage)

    const logs = storage.forecastLogs(TEAM)
    expect(logs.map(({ id, simulationCase }) => ({ id, tickets: simulationCase.scope[0]?.currentCount }))).toEqual([
      { id: 1, tickets: 10 },
      { id: 2, tickets: 20 },
    ])
    expect(logs[1]?.result.percentileDates).toEqual({ 50: '2026-09-29', 70: '2026-09-29', 85: '2026-09-29', 95: '2026-09-29' })
  })
})

describe('logging only the forecast shown', () => {
  test('with the Capacity section open, only the forecast shown is logged, with its capacity, not the runs each entry is compared with', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-07', ticketsRemaining: '10' }, { low: '5', high: '5' })
    submit(storage, { kind: 'addCapacity', percent: '0', from: '2026-09-07', to: '2026-09-11', onward: false, note: 'Offsite' })

    const shown = milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { capacityOpen: true })

    expect(shown.kind === 'forecast' && shown.capacity.entries.map(({ effect }) => effect?.shift)).toEqual([1])
    const logs = storage.forecastLogs(TEAM)
    expect(logs).toHaveLength(1)
    expect(logs[0]?.simulationCase.capacity?.[0]).toBe(0)
    expect(logs[0]?.result.percentileDates[85]).toBe('2026-09-28')
  })

  test('a team with no milestone yet is shown no forecast, so nothing is logged', () => {
    const storage = newTeam()

    expect(view(storage).kind).not.toBe('forecast')
    expect(storage.forecastLogs(TEAM)).toEqual([])
  })
})

describe.each(storages)('re-running a forecast logged in %s storage', (_, opened) => {
  test('re-running a logged case alone, read back after reopening and with the inputs since changed, gives the result logged', () => {
    const { storage, reopen } = opened()
    mediumGrowth(storage, { low: 1.1, high: 1.6 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '40' }, { low: '3', high: '8' })
    view(storage)
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '25' }, { low: '2', high: '9' })
    view(storage)

    const [first, second] = reopen().forecastLogs(TEAM)

    expect(first && rerunForecast(first)).toEqual({ kind: 'rerun', result: first?.result })
    expect(second && rerunForecast(second)).toEqual({ kind: 'rerun', result: second?.result })
    expect(first?.result).not.toEqual(second?.result)
  })
})

describe('re-running a logged forecast', () => {
  test('a case logged by another engine version is not re-run, as this engine may not give its result', () => {
    const storage = newTeam()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    view(storage)
    const [shown] = storage.forecastLogs(TEAM)
    if (!shown) throw new Error('no forecast logged')
    const { id: _id, createdAt: _createdAt, ...logged } = shown
    storage.saveForecastLog({ ...logged, simulationCase: { ...logged.simulationCase, engineVersion: '1' } })

    const [, older] = storage.forecastLogs(TEAM)

    expect(older && rerunForecast(older)).toEqual({ kind: 'otherEngine', loggedWith: '1', running: '2' })
  })
})

describe.each(storages)('a forecast logged in %s storage that this version cannot read', (_, opened) => {
  test('as a later engine would log one, does not stop the forecast being shown, and the next is logged after it, once', () => {
    const { storage, reopen } = opened()
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })
    view(storage)
    const [shown] = storage.forecastLogs(TEAM)
    if (!shown) throw new Error('no forecast logged')
    const { id: _id, createdAt: _createdAt, ...logged } = shown
    // a case of a shape this version doesn't know, as a later engine's SimulationCase would be
    storage.saveForecastLog({ ...logged, simulationCase: Object.assign({}, logged.simulationCase, { question: { kind: 'whenBy' } }) })
    expect(() => reopen().forecastLogs(TEAM)).toThrow("can't read")
    enter(reopen(), { startDate: '2026-09-01', ticketsRemaining: '20' }, { low: '5', high: '5' })

    expect(view(reopen())).toMatchObject({ kind: 'forecast' })
    expect(view(reopen())).toMatchObject({ kind: 'forecast' })

    expect(reopen().lastForecastLog(TEAM)).toEqual({
      id: 3,
      teamId: TEAM,
      createdAt: expect.any(String),
      milestoneName: 'Checkout v2',
      caseHash: expect.stringMatching(/^[0-9a-f]{16}$/),
      appVersion: APP_VERSION,
    })
    expect(reopen().lastForecastLog(TEAM)?.caseHash).not.toBe(shown.result.caseHash)
  })
})

describe('a forecast ledger browser storage cannot read', () => {
  test.each([
    ["text that isn't JSON", 'not json'],
    ["logs of a shape this version doesn't know", JSON.stringify({ ACME: [{ id: 1 }] })],
  ])('holding %s, does not stop the forecast being shown, and keeps the ledger as it was', (_, stored) => {
    const store = memoryStore()
    store.items.set('forecaster.ledger', stored)
    const storage = newTeam(openWebStorage(store))
    mediumGrowth(storage, { low: 1, high: 1 })
    enter(storage, { startDate: '2026-09-01', ticketsRemaining: '10' }, { low: '5', high: '5' })

    expect(view(storage)).toMatchObject({ kind: 'forecast' })
    expect(view(openWebStorage(store))).toMatchObject({ kind: 'forecast' })

    expect(store.items.get('forecaster.ledger')).toBe(stored)
    expect(() => openWebStorage(store).forecastLogs(TEAM)).toThrow('"forecaster.ledger"')
  })
})
