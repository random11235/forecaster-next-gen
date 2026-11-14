import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, test } from 'vitest'
import type { AmbiguityRanges } from '../../src/model/ambiguity.js'
import type { CapacityEntry } from '../../src/model/capacity.js'
import type { Connection } from '../../src/model/connection.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { SavedRead } from '../../src/model/savedRead.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { Team } from '../../src/model/team.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { ConnectionStorage, MilestoneQueryStorage, SavedReadStorage, SetupStorage, Storage } from '../../src/storage/storage.js'
import { openWebStorage, type KeyValueStore } from '../../src/storage/webStorage.js'

// What every Storage keeps, whatever it keeps it in: the local app's SQLite file and the web build's browser storage.

const TEAM: Team = { id: 'team', name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' }

const LAUNCH: MilestoneInputs = {
  teamId: 'team',
  name: 'Launch',
  startDate: '2026-11-02',
  ticketsRemaining: 30,
  ticketsSource: 'typed',
  ambiguity: 'high',
  cadenceDays: 14,
  paceMode: 'counts',
  paceRange: { low: 5, high: 10 },
  paceCounts: [4, 7, 6],
  paceCadenceDays: 14,
  paceWindow: { action: { kind: 'startFrom', date: '2026-10-12' }, skippedPeriods: [] },
  seenReads: { ticketsRemaining: undefined, pace: undefined },
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
  function sqliteFile(): { storage: Storage & ConnectionStorage; reopen: () => Storage & ConnectionStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): Storage & ConnectionStorage => {
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
    finishedSince: '2026-09-09T08:15:00Z',
  }

  function sqliteFile(): { storage: Storage & SavedReadStorage; reopen: () => Storage & SavedReadStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): Storage & SavedReadStorage => {
      open?.close()
      const storage = openSqliteStorage(file)
      open = storage
      return storage
    }
    return { storage: reopen(), reopen }
  }

  test("keeps a query's last read, with its tickets in order, whether it was incomplete, when it was read, and how far back", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)

    expect(storage.savedRead({ teamId: 'team', query: OPEN_TICKETS })).toBeUndefined()
    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, READ)

    expect(reopen().savedRead({ teamId: 'team', query: OPEN_TICKETS })).toEqual(READ)
  })

  test("replaces a query's saved read whole, leaving the team's other queries and other teams' reads as they were", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveTeam({ ...TEAM, id: 'another' })
    const otherQuery = 'repo:acme/checkout is:issue milestone:"Beta"'
    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, READ)
    storage.saveRead({ teamId: 'team', query: otherQuery }, READ)
    storage.saveRead({ teamId: 'another', query: OPEN_TICKETS }, READ)

    const later: SavedRead = { tickets: [{ id: 'I_2', finishedAt: '2026-11-12T10:00:00Z' }], incomplete: true, readAt: '2026-11-12T11:00:00Z', finishedSince: '2026-09-10T11:00:00Z' }
    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, later)

    const again = reopen()
    expect(again.savedRead({ teamId: 'team', query: OPEN_TICKETS })).toEqual(later)
    expect(again.savedRead({ teamId: 'team', query: otherQuery })).toEqual(READ)
    expect(again.savedRead({ teamId: 'another', query: OPEN_TICKETS })).toEqual(READ)
  })

  // the faint previous value comes from the read the latest replaced (#214)
  test("keeps the read a query's latest replaced as its previous read, one back, apart from other queries'", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const otherQuery = 'repo:acme/checkout is:issue milestone:"Beta"'
    const later: SavedRead = { tickets: [{ id: 'I_2', finishedAt: '2026-11-12T10:00:00Z' }], incomplete: true, readAt: '2026-11-12T11:00:00Z', finishedSince: '2026-09-10T11:00:00Z' }
    const latest: SavedRead = { tickets: [], incomplete: false, readAt: '2026-11-13T11:00:00Z', finishedSince: '2026-09-11T11:00:00Z' }

    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, READ)
    storage.saveRead({ teamId: 'team', query: otherQuery }, READ)
    expect(storage.previousRead({ teamId: 'team', query: OPEN_TICKETS })).toBeUndefined()

    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, later)
    const reopened = reopen()
    expect(reopened.previousRead({ teamId: 'team', query: OPEN_TICKETS })).toEqual(READ)

    reopened.saveRead({ teamId: 'team', query: OPEN_TICKETS }, latest)
    const again = reopen()
    expect(again.savedRead({ teamId: 'team', query: OPEN_TICKETS })).toEqual(latest)
    expect(again.previousRead({ teamId: 'team', query: OPEN_TICKETS })).toEqual(later)
    expect(again.previousRead({ teamId: 'team', query: otherQuery })).toBeUndefined()
  })

  test('keeps a read that matched nothing as an empty list', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const empty: SavedRead = { tickets: [], incomplete: false, readAt: '2026-11-11T08:15:00Z', finishedSince: '2026-09-16T08:15:00Z' }

    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, empty)

    expect(reopen().savedRead({ teamId: 'team', query: OPEN_TICKETS })).toEqual(empty)
  })

  test("keeps nothing of a ticket but its id and finish time, whatever else it is handed", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const handed = { id: 'I_1', finishedAt: '2026-11-06T22:30:00Z', title: 'Fix checkout', assignee: 'sam' }

    storage.saveRead({ teamId: 'team', query: OPEN_TICKETS }, { ...READ, tickets: [handed] })

    expect(reopen().savedRead({ teamId: 'team', query: OPEN_TICKETS })!.tickets).toStrictEqual([{ id: 'I_1', finishedAt: '2026-11-06T22:30:00Z' }])
  })
})

// Only the local server build keeps the milestone's picks and query: the browser build has no connectors (#190).
describe("SQLite storage's milestone query", () => {
  const PICKED: MilestoneQuery = {
    picks: [
      { kind: 'epic', name: 'Checkout redesign', query: 'parent-issue:acme/checkout#106' },
      { kind: 'label', name: 'payments', query: 'label:"payments"' },
    ],
    query: 'parent-issue:acme/checkout#106 OR label:"payments"',
  }

  function sqliteFile(): { storage: Storage & MilestoneQueryStorage; reopen: () => Storage & MilestoneQueryStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): Storage & MilestoneQueryStorage => {
      open?.close()
      const storage = openSqliteStorage(file)
      open = storage
      return storage
    }
    return { storage: reopen(), reopen }
  }

  test("keeps the milestone's picks in order and its query, replacing both when saved again", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveMilestoneInputs(LAUNCH)

    expect(storage.milestoneQuery('team')).toBeUndefined()
    storage.saveMilestoneQuery('team', { picks: [{ kind: 'milestone', name: 'Beta', query: 'milestone:"Beta"' }], query: 'milestone:"Beta"' })
    storage.saveMilestoneQuery('team', PICKED)

    const again = reopen()
    expect(again.milestoneQuery('team')).toEqual(PICKED)
    expect(again.milestoneQuery('another')).toBeUndefined()
    expect(again.milestoneInputs('team')).toEqual(LAUNCH)
  })

  test('keeps a hand-edited query as written, beside the picks it was edited from', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const edited: MilestoneQuery = { picks: PICKED.picks, query: 'label:checkout -label:bug' }

    storage.saveMilestoneQuery('team', edited)

    expect(reopen().milestoneQuery('team')).toEqual(edited)
  })

  test('keeps a milestone with no picks and an empty query', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)

    storage.saveMilestoneQuery('team', { picks: [], query: '' })

    expect(reopen().milestoneQuery('team')).toEqual({ picks: [], query: '' })
  })

  test('keeps nothing of a pick but its kind, name and query, whatever else it is handed', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const handed = { kind: 'label' as const, name: 'payments', query: 'label:"payments"', overHundred: true }

    storage.saveMilestoneQuery('team', { picks: [handed], query: 'label:"payments"' })

    expect(reopen().milestoneQuery('team')!.picks).toStrictEqual([{ kind: 'label', name: 'payments', query: 'label:"payments"' }])
  })

  test('reads back no pick of a kind it doesn’t know, keeping the query and the other picks', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveMilestoneQuery('team', PICKED)
    const db = new DatabaseSync(join(dir!, 'forecaster.db'))
    const stored = [{ kind: 'component', name: 'Payments', query: 'component = Payments' }, ...PICKED.picks]
    db.prepare('UPDATE milestone_queries SET picks = ?').run(JSON.stringify(stored))
    db.close()

    expect(reopen().milestoneQuery('team')).toEqual(PICKED)
  })

  // Comparable work's picks and query (#201), kept beside the milestone's, in the same shape, apart from it.
  test("keeps comparable work's picks in order and its query apart from the milestone's, replacing both when saved again", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    const comparable: MilestoneQuery = {
      picks: [
        { kind: 'label', name: 'checkout', query: 'label:"checkout"' },
        { kind: 'epic', name: 'Wallet', query: 'parent-issue:acme/checkout#88' },
      ],
      query: 'label:"checkout" OR parent-issue:acme/checkout#88',
    }

    expect(storage.comparableWorkQuery('team')).toBeUndefined()
    storage.saveMilestoneQuery('team', PICKED)
    storage.saveComparableWorkQuery('team', { picks: [], query: 'label:"beta"' })
    storage.saveComparableWorkQuery('team', comparable)

    const again = reopen()
    expect(again.comparableWorkQuery('team')).toEqual(comparable)
    expect(again.comparableWorkQuery('another')).toBeUndefined()
    expect(again.milestoneQuery('team')).toEqual(PICKED)
  })

  test("reads back no comparable-work pick of a kind it doesn't know, keeping the query", () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveComparableWorkQuery('team', PICKED)
    const db = new DatabaseSync(join(dir!, 'forecaster.db'))
    const stored = [{ kind: 'component', name: 'Payments', query: 'component = Payments' }, ...PICKED.picks]
    db.prepare('UPDATE comparable_work_queries SET picks = ?').run(JSON.stringify(stored))
    db.close()

    expect(reopen().comparableWorkQuery('team')).toEqual(PICKED)
  })
})

describe("SQLite storage's setup", () => {
  function sqliteFile(): { storage: Storage & SetupStorage; reopen: () => Storage & SetupStorage } {
    dir = mkdtempSync(join(tmpdir(), 'forecaster-'))
    const file = join(dir, 'forecaster.db')
    const reopen = (): Storage & SetupStorage => {
      open?.close()
      const storage = openSqliteStorage(file)
      open = storage
      return storage
    }
    return { storage: reopen(), reopen }
  }

  // How the team's setup steps were closed (#217): done with "Use these", or connecting skipped; open until either.
  test('keeps how setup was closed, replacing it when closed again, until it is reopened', () => {
    const { storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)

    expect(storage.setupClosed('team')).toBeUndefined()
    storage.closeSetup('team', 'skipped')
    storage.closeSetup('team', 'done')
    expect(reopen().setupClosed('team')).toBe('done')
    expect(reopen().setupClosed('another')).toBeUndefined()

    reopen().reopenSetup('team')
    expect(reopen().setupClosed('team')).toBeUndefined()
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

  test('with stored data it cannot read, starts empty', () => {
    const store = memoryStore()
    store.setItem('forecaster', 'not json')

    expect(openWebStorage(store).isEmpty()).toBe(true)
  })
})
