import { describe, expect, test } from 'vitest'
import type { AmbiguityRanges } from '../../src/model/ambiguity.js'
import type { CapacityEntry } from '../../src/model/capacity.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'
import { FORECAST, LAUNCH, TEAM, temporarySqliteFiles } from './storageContractFixtures.js'

// What every Storage keeps, whatever it keeps it in: the local app's SQLite file and the web build's browser storage.

const RANGES: AmbiguityRanges = {
  teamId: 'team',
  low: { low: 1, high: 1.2 },
  medium: { low: 1.1, high: 1.6 },
  high: { low: 1.4, high: 2.5 },
}

/** A Storage to test, and a way to open it again on the same data, as a relaunch or a reload does. */
interface Opened {
  storage: Storage
  reopen: () => Storage
}

/** Browser storage as `localStorage` keeps it: strings by key. */
const HOLIDAY: CapacityEntry = { id: 1, from: '2026-09-14', to: '2026-09-14', percent: 0, note: 'Holiday' }
/**
 * One entry running onward, saved before an earlier one: kept in the order saved. With one accepted as the new usual,
 * and one kept when proposed.
 */
const ENTRIES: CapacityEntry[] = [
  { id: 2, from: '2026-10-05', to: undefined, percent: 60, note: '' },
  HOLIDAY,
  { id: 3, from: '2026-06-01', to: '2026-11-11', percent: 80, note: 'Two left', newUsualOn: '2026-11-11' },
  { id: 4, from: '2026-07-06', to: undefined, percent: 120, note: '', kept: true },
]

function memoryStore(): KeyValueStore {
  const items = new Map<string, string>()
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
}

const sqliteFile = temporarySqliteFiles()

const kinds: [string, () => Opened][] = [
  ['SQLite', sqliteFile],
  [
    'browser',
    () => {
      const store = memoryStore()
      return { storage: openWebStorage(store), reopen: () => openWebStorage(store) }
    },
  ],
]

describe.each(kinds)('%s storage', (_, opened) => {
  test('is empty until a team is saved', () => {
    const { storage } = opened()

    expect(storage.isEmpty()).toBe(true)
    expect(storage.teams()).toEqual([])
    storage.saveTeam(TEAM)
    expect(storage.isEmpty()).toBe(false)
  })

  test('keeps a team, updating it by ID but keeping when it was installed', () => {
    const { storage } = opened()

    storage.saveTeam(TEAM)
    storage.saveTeam({ ...TEAM, name: 'Payments', installedAt: '2026-06-01T00:00:00Z' })

    expect(storage.teams()).toEqual([{ ...TEAM, name: 'Payments' }])
  })

  test("keeps the team's milestone inputs, replacing them when saved again", () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)

    expect(storage.milestoneInputs('team')).toBeUndefined()
    storage.saveMilestoneInputs({ ...LAUNCH, name: 'First go' })
    storage.saveMilestoneInputs(LAUNCH)

    expect(storage.milestoneInputs('team')).toEqual(LAUNCH)
  })

  test('keeps milestone inputs with nothing entered yet', () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)
    const bare: MilestoneInputs = {
      ...LAUNCH,
      startDate: undefined,
      ticketsRemaining: undefined,
      paceRange: undefined,
      paceCounts: [],
      paceWindow: { action: undefined, skippedPeriods: [] },
    }

    storage.saveMilestoneInputs(bare)

    expect(storage.milestoneInputs('team')).toEqual(bare)
  })

  test('keeps either pace action: counting from a date, or leaving out a period', () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)
    const leftOut: MilestoneInputs = { ...LAUNCH, paceWindow: { action: { kind: 'leaveOut', period: '2026-10-12' }, skippedPeriods: [] } }

    storage.saveMilestoneInputs(leftOut)

    expect(storage.milestoneInputs('team')).toEqual(leftOut)
  })

  test("keeps each value's source following the tracker, the skipped periods and the reads seen, opened again", () => {
    const { storage, reopen } = opened()
    storage.saveTeam(TEAM)
    const following: MilestoneInputs = {
      ...LAUNCH,
      ticketsSource: 'tracker',
      paceMode: 'tracker',
      paceWindow: { action: undefined, skippedPeriods: ['2026-12-21', '2026-12-28'] },
      seenReads: { ticketsRemaining: '2026-10-28T09:05:00Z', pace: undefined },
    }

    storage.saveMilestoneInputs(following)

    expect(reopen().milestoneInputs('team')).toEqual(following)
  })

  test("keeps the team's ambiguity ranges, replacing them when saved again", () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)

    expect(storage.ambiguityRanges('team')).toBeUndefined()
    storage.saveAmbiguityRanges({ ...RANGES, high: { low: 2, high: 3 } })
    storage.saveAmbiguityRanges(RANGES)

    expect(storage.ambiguityRanges('team')).toEqual(RANGES)
  })

  test("keeps the team's capacity entries, in the order saved, replacing them when saved again", () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)

    expect(storage.capacityEntries('team')).toEqual([])
    storage.saveCapacityEntries('team', [HOLIDAY])
    storage.saveCapacityEntries('team', ENTRIES)

    expect(storage.capacityEntries('team')).toEqual(ENTRIES)
    expect(storage.capacityEntries('another')).toEqual([])
  })

  test("switches the team's capacity off and on again, on until switched", () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)

    expect(storage.capacityOn('team')).toBe(true)
    storage.saveCapacityOn('team', false)
    expect(storage.capacityOn('team')).toBe(false)
    expect(storage.capacityOn('another')).toBe(true)
    storage.saveCapacityOn('team', true)

    expect(storage.capacityOn('team')).toBe(true)
  })

  test("logs the team's forecasts in the order logged, numbered for the team and stamped when logged, which survive reopening", () => {
    const { storage, reopen } = opened()
    storage.saveTeam(TEAM)
    storage.saveTeam({ ...TEAM, id: 'another', name: 'Another' })
    const withoutCapacity = { ...FORECAST, simulationCase: { ...FORECAST.simulationCase, capacity: undefined }, milestoneName: 'Beta' }
    expect(storage.forecastLogs('team')).toEqual([])
    expect(storage.lastForecastLog('team')).toBeUndefined()
    const before = new Date().toISOString()

    storage.saveForecastLog(FORECAST)
    storage.saveForecastLog({ ...FORECAST, teamId: 'another' })
    storage.saveForecastLog(withoutCapacity)

    const after = new Date().toISOString()
    const logs = reopen().forecastLogs('team')
    expect(logs).toEqual([
      { ...FORECAST, id: 1, createdAt: expect.any(String) },
      { ...withoutCapacity, id: 2, createdAt: expect.any(String) },
    ])
    expect(logs.every(({ createdAt }) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt) && createdAt >= before && createdAt <= after)).toBe(true)
    expect(reopen().lastForecastLog('team')).toEqual(logs[1])
    expect(reopen().forecastLogs('another')).toEqual([{ ...FORECAST, teamId: 'another', id: 1, createdAt: expect.any(String) }])
  })

  test('opened again, has everything saved before', () => {
    const { storage, reopen } = opened()
    storage.saveTeam(TEAM)
    storage.saveMilestoneInputs(LAUNCH)
    storage.saveAmbiguityRanges(RANGES)
    storage.saveCapacityEntries('team', ENTRIES)
    storage.saveCapacityOn('team', false)

    const again = reopen()

    expect(again.teams()).toEqual([TEAM])
    expect(again.milestoneInputs('team')).toEqual(LAUNCH)
    expect(again.ambiguityRanges('team')).toEqual(RANGES)
    expect(again.capacityEntries('team')).toEqual(ENTRIES)
    expect(again.capacityOn('team')).toBe(false)
  })
})

// Only the local server build keeps a connection: the browser build has no connectors (#155), so its Storage has no
// place for one.

describe('browser storage the browser refuses', () => {
  const refusing: KeyValueStore = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('SecurityError')
    },
  }

  test.each([
    ['no browser storage at all', undefined],
    ['browser storage that throws', refusing],
  ])('with %s, starts empty and keeps what is saved until the page closes', (_, store) => {
    const storage = openWebStorage(store)

    expect(storage.isEmpty()).toBe(true)
    storage.saveTeam(TEAM)
    storage.saveMilestoneInputs(LAUNCH)

    expect(storage.teams()).toEqual([TEAM])
    expect(storage.milestoneInputs('team')).toEqual(LAUNCH)
  })

  test('with a milestone stored before the pace window, reads it with no action applied', () => {
    const store = memoryStore()
    const { paceWindow: _, ...before } = LAUNCH
    const stored = { teams: [TEAM], milestoneInputs: { team: before }, ambiguityRanges: {}, capacityEntries: {}, capacityOff: [] }
    store.setItem('forecaster', JSON.stringify(stored))

    expect(openWebStorage(store).milestoneInputs('team')).toEqual({ ...LAUNCH, paceWindow: { action: undefined, skippedPeriods: [] } })
  })

  test('with a milestone stored before sources, reads it with tickets typed, its pace mode, no skips and nothing seen', () => {
    const store = memoryStore()
    const { ticketsSource: _, seenReads: __, ...before } = LAUNCH
    const stored = {
      teams: [TEAM],
      milestoneInputs: { team: { ...before, paceWindow: { action: LAUNCH.paceWindow.action } } },
      ambiguityRanges: {},
      capacityEntries: {},
      capacityOff: [],
    }
    store.setItem('forecaster', JSON.stringify(stored))

    const read = openWebStorage(store).milestoneInputs('team')
    expect(read).toEqual(LAUNCH)
    expect(read).toHaveProperty('seenReads', { ticketsRemaining: undefined, pace: undefined })
  })
})
