import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { AmbiguityRanges } from '../../src/model/ambiguity.js'
import type { CapacityEntry } from '../../src/model/capacity.js'
import type { Connection } from '../../src/model/connection.js'
import type { SavedRead } from '../../src/model/savedRead.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'

// What every Storage keeps, whatever it keeps it in: the local app's SQLite file and the web build's browser storage.

const TEAM: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' }

const LAUNCH: MilestoneInputs = {
  teamId: 'team',
  name: 'Launch',
  startDate: '2026-11-02',
  ticketsRemaining: 30,
  ambiguity: 'high',
  cadenceDays: 14,
  paceMode: 'counts',
  paceRange: { low: 5, high: 10 },
  paceCounts: [4, 7, 6],
  paceCadenceDays: 14,
  paceWindow: { action: { kind: 'startFrom', date: '2026-10-12' } },
}

const RANGES: AmbiguityRanges = {
  teamId: 'team',
  low: { low: 1, high: 1.2 },
  medium: { low: 1.1, high: 1.6 },
  high: { low: 1.4, high: 2.5 },
}

const GITHUB: Connection = { tracker: 'github', owner: 'acme', repo: 'checkout' }
const JIRA: Connection = { tracker: 'jira', site: 'acme.atlassian.net', projectKey: 'PAY', email: 'em@acme.example' }

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

let dir: string | undefined
let open: Storage | undefined

afterEach(() => {
  open?.close()
  open = undefined
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

const kinds: [string, () => Opened][] = [
  [
    'SQLite',
    () => {
      dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
      const file = join(dir, 'forecaster.db')
      open = openSqliteStorage(file)
      return {
        storage: open,
        reopen: () => {
          open?.close()
          return (open = openSqliteStorage(file))
        },
      }
    },
  ],
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
      paceWindow: { action: undefined },
    }

    storage.saveMilestoneInputs(bare)

    expect(storage.milestoneInputs('team')).toEqual(bare)
  })

  test('keeps either pace action: counting from a date, or leaving out a period', () => {
    const { storage } = opened()
    storage.saveTeam(TEAM)
    const leftOut: MilestoneInputs = { ...LAUNCH, paceWindow: { action: { kind: 'leaveOut', period: '2026-10-12' } } }

    storage.saveMilestoneInputs(leftOut)

    expect(storage.milestoneInputs('team')).toEqual(leftOut)
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
describe("SQLite storage's connection", () => {
  function sqliteFile(): { storage: SqliteStorage; reopen: () => SqliteStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): SqliteStorage => {
      open?.close()
      const storage = openSqliteStorage(file)
      open = storage
      return storage
    }
    return { storage: reopen(), reopen }
  }

  test("keeps the team's connection, replacing it when saved again, until it is removed", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)

    expect(storage.connection('team')).toBeUndefined()
    storage.saveConnection('team', GITHUB)
    storage.saveConnection('team', JIRA)
    expect(storage.connection('team')).toEqual(JIRA)
    expect(storage.connection('another')).toBeUndefined()

    const again = reopen()
    expect(again.connection('team')).toEqual(JIRA)
    again.removeConnection('team')

    expect(again.connection('team')).toBeUndefined()
    expect(reopen().connection('team')).toBeUndefined()
  })

  test('keeps a GitHub connection as saved', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)

    storage.saveConnection('team', GITHUB)

    expect(reopen().connection('team')).toEqual(GITHUB)
  })

  test('removing a connection the team does not have changes nothing', () => {
    const { storage } = sqliteFile()
    storage.saveTeam(TEAM)

    storage.removeConnection('team')

    expect(storage.connection('team')).toBeUndefined()
  })
})

// Only the local server build keeps saved reads: the browser build has no connectors (#183).
describe("SQLite storage's saved reads", () => {
  const OPEN_TICKETS = 'repo:acme/checkout is:issue milestone:"Launch"'
  const READ: SavedRead = {
    tickets: [{ id: 'I_1', finishedAt: '2026-11-06T22:30:00Z' }, { id: 'I_2' }, { id: 'I_3', finishedAt: '2026-10-30T09:00:00Z' }],
    incomplete: false,
    readAt: '2026-11-11T08:15:00Z',
  }

  function sqliteFile(): { storage: SqliteStorage; reopen: () => SqliteStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): SqliteStorage => {
      open?.close()
      const storage = openSqliteStorage(file)
      open = storage
      return storage
    }
    return { storage: reopen(), reopen }
  }

  test("keeps a query's last read, with its tickets in order, whether it was incomplete, and when it was read", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)

    expect(storage.savedRead('team', OPEN_TICKETS)).toBeUndefined()
    storage.saveRead('team', OPEN_TICKETS, READ)

    expect(reopen().savedRead('team', OPEN_TICKETS)).toEqual(READ)
  })

  test("replaces a query's saved read whole, leaving the team's other queries and other teams' reads as they were", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveTeam({ ...TEAM, id: 'another' })
    const otherQuery = 'repo:acme/checkout is:issue milestone:"Beta"'
    storage.saveRead('team', OPEN_TICKETS, READ)
    storage.saveRead('team', otherQuery, READ)
    storage.saveRead('another', OPEN_TICKETS, READ)

    const later: SavedRead = { tickets: [{ id: 'I_2', finishedAt: '2026-11-12T10:00:00Z' }], incomplete: true, readAt: '2026-11-12T11:00:00Z' }
    storage.saveRead('team', OPEN_TICKETS, later)

    const again = reopen()
    expect(again.savedRead('team', OPEN_TICKETS)).toEqual(later)
    expect(again.savedRead('team', otherQuery)).toEqual(READ)
    expect(again.savedRead('another', OPEN_TICKETS)).toEqual(READ)
  })

  test('keeps a read that matched nothing as an empty list', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const empty: SavedRead = { tickets: [], incomplete: false, readAt: '2026-11-11T08:15:00Z' }

    storage.saveRead('team', OPEN_TICKETS, empty)

    expect(reopen().savedRead('team', OPEN_TICKETS)).toEqual(empty)
  })

  test("keeps nothing of a ticket but its id and finish time, whatever else it is handed", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const handed = { id: 'I_1', finishedAt: '2026-11-06T22:30:00Z', title: 'Fix checkout', assignee: 'sam' }

    storage.saveRead('team', OPEN_TICKETS, { ...READ, tickets: [handed] })

    expect(reopen().savedRead('team', OPEN_TICKETS)!.tickets).toStrictEqual([{ id: 'I_1', finishedAt: '2026-11-06T22:30:00Z' }])
  })
})

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

    expect(openWebStorage(store).milestoneInputs('team')).toEqual({ ...LAUNCH, paceWindow: { action: undefined } })
  })

  test('with stored data it cannot read, starts empty', () => {
    const store = memoryStore()
    store.setItem('forecaster', 'not json')

    expect(openWebStorage(store).isEmpty()).toBe(true)
  })
})
