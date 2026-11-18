import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import type { Connection } from '../../src/model/connection.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { SavedRead } from '../../src/model/savedRead.js'
import { LAUNCH, TEAM, temporarySqliteFiles } from './storageContractFixtures.js'

// The Storage contract's cases for what only the SQLite file keeps, beside storageContract.test.ts: the team's
// connection, each query's saved reads, and the milestone query and comparable work's.

const GITHUB: Connection = { tracker: 'github', owner: 'acme', repo: 'checkout' }
const JIRA: Connection = { tracker: 'jira', site: 'acme.atlassian.net', projectKey: 'PAY', email: 'em@acme.example' }

const sqliteFile = temporarySqliteFiles()

describe("SQLite storage's connection", () => {
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

    const later: SavedRead = {
      tickets: [{ id: 'I_2', finishedAt: '2026-11-12T10:00:00Z' }],
      incomplete: true,
      readAt: '2026-11-12T11:00:00Z',
      finishedSince: '2026-09-10T11:00:00Z',
    }
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
    const later: SavedRead = {
      tickets: [{ id: 'I_2', finishedAt: '2026-11-12T10:00:00Z' }],
      incomplete: true,
      readAt: '2026-11-12T11:00:00Z',
      finishedSince: '2026-09-10T11:00:00Z',
    }
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

  test('keeps nothing of a ticket but its id and finish time, whatever else it is handed', () => {
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
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveMilestoneQuery('team', PICKED)
    const db = new DatabaseSync(file)
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
    const { file, storage, reopen } = sqliteFile()
    storage.saveTeam(TEAM)
    storage.saveComparableWorkQuery('team', PICKED)
    const db = new DatabaseSync(file)
    const stored = [{ kind: 'component', name: 'Payments', query: 'component = Payments' }, ...PICKED.picks]
    db.prepare('UPDATE comparable_work_queries SET picks = ?').run(JSON.stringify(stored))
    db.close()

    expect(reopen().comparableWorkQuery('team')).toEqual(PICKED)
  })
})
