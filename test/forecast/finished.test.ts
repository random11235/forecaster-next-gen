import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import { finishedPerPeriod, readQuery, ticketsRemaining } from '../../src/forecast/finished.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Finished tickets per period and tickets remaining, from a query's saved read (#187).

const TEAM = 'team'
const QUERY = 'milestone:"Checkout v2"'
const READ_AT = '2026-10-26T09:00:00Z'
const SINCE = '2026-09-01T00:00:00Z'

let dir: string
let storage: SqliteStorage

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-finished-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Reads QUERY through the canned connector answering with `tickets`, and returns the read it saved. */
async function readOf(tickets: { id: string; finishedAt?: string }[]) {
  const fixture: CannedFixture = { milestoneChoices: [], reads: { [QUERY]: { tickets, incomplete: false } } }
  const result = await readQuery(cannedConnector(fixture), storage, { teamId: TEAM, query: QUERY, finishedSince: SINCE, readAt: READ_AT })
  if (!result.ok) throw new Error(`read failed: ${result.failure}`)
  return result.read
}

describe('finished tickets per period', () => {
  // Weeks from Saturday 3 Oct; today is Monday 26 Oct, in the week of 24 Oct, which is left out.
  const WEEKS = { startDate: '2026-10-03', cadenceDays: 7, today: '2026-10-26', periods: 3 }

  test('a finish late on Friday counts in Friday’s week in the EM’s time zone, though it is Saturday in UTC', async () => {
    // 02:30 UTC on Saturday 17 Oct is 22:30 on Friday 16 Oct in New York
    const read = await readOf([{ id: 'a', finishedAt: '2026-10-17T02:30:00Z' }])
    expect(finishedPerPeriod(read, { ...WEEKS, timeZone: 'America/New_York' })).toEqual({
      counts: [0, 1, 0],
      starts: ['2026-10-03', '2026-10-10', '2026-10-17'],
    })
    expect(finishedPerPeriod(read, { ...WEEKS, timeZone: 'UTC' }).counts).toEqual([0, 0, 1])
  })

  test('at a 7-day cadence, each finish counts in its week; quiet weeks are 0 and the current week is left out', async () => {
    const read = await readOf([
      { id: 'a', finishedAt: '2026-09-27T12:00:00Z' }, // before the window
      { id: 'b', finishedAt: '2026-10-03T00:00:00Z' }, // first day of the week of 3 Oct
      { id: 'c', finishedAt: '2026-10-09T23:59:00Z' }, // last day of the week of 3 Oct
      { id: 'd', finishedAt: '2026-10-19T08:00:00Z' },
      { id: 'e', finishedAt: '2026-10-24T08:00:00Z' }, // the current week
      { id: 'f' },
    ])
    expect(finishedPerPeriod(read, { ...WEEKS, timeZone: 'UTC' })).toEqual({
      counts: [2, 0, 1],
      starts: ['2026-10-03', '2026-10-10', '2026-10-17'],
    })
  })

  test('at a 14-day cadence, each finish counts in its sprint, laid back from the current sprint', async () => {
    // Sprints from Saturday 5 Sep: 5 Sep, 19 Sep, 3 Oct, and the current one, 17 Oct, holding 26 Oct
    const read = await readOf([
      { id: 'a', finishedAt: '2026-09-10T10:00:00Z' },
      { id: 'b', finishedAt: '2026-10-05T10:00:00Z' },
      { id: 'c', finishedAt: '2026-10-16T10:00:00Z' },
      { id: 'd', finishedAt: '2026-10-20T10:00:00Z' },
    ])
    const sprints = { startDate: '2026-09-05', cadenceDays: 14, today: '2026-10-26', periods: 3, timeZone: 'UTC' }
    expect(finishedPerPeriod(read, sprints)).toEqual({ counts: [1, 0, 2], starts: ['2026-09-05', '2026-09-19', '2026-10-03'] })
  })
})

describe('reading a query', () => {
  test('saves the read, with when it was read and how far back, replacing the last one', async () => {
    await readOf([{ id: 'a' }])
    const read = await readOf([{ id: 'b', finishedAt: '2026-10-05T10:00:00Z' }])
    expect(read).toEqual({ tickets: [{ id: 'b', finishedAt: '2026-10-05T10:00:00Z' }], incomplete: false, readAt: READ_AT, finishedSince: SINCE })
    expect(storage.savedRead({ teamId: TEAM, query: QUERY })).toEqual(read)
  })

  test('a failed read keeps the saved read', async () => {
    const saved = await readOf([{ id: 'a' }, { id: 'b', finishedAt: '2026-10-05T10:00:00Z' }])
    const failing: CannedFixture = { milestoneChoices: [], reads: { [QUERY]: { failure: 'unavailable' } } }
    const result = await readQuery(cannedConnector(failing), storage, { teamId: TEAM, query: QUERY, finishedSince: SINCE, readAt: '2026-10-27T09:00:00Z' })
    expect(result).toEqual({ ok: false, failure: 'unavailable', saved })
    expect(storage.savedRead({ teamId: TEAM, query: QUERY })).toEqual(saved)
  })

  test('a failed first read has no saved read', async () => {
    const failing: CannedFixture = { milestoneChoices: [], reads: { [QUERY]: { failure: 'unauthorised' } } }
    expect(await readQuery(cannedConnector(failing), storage, { teamId: TEAM, query: QUERY, finishedSince: SINCE, readAt: READ_AT })).toEqual({ ok: false, failure: 'unauthorised', saved: undefined })
  })
})

test('tickets remaining counts the read’s open tickets', async () => {
  const read = await readOf([{ id: 'a' }, { id: 'b', finishedAt: '2026-10-05T10:00:00Z' }, { id: 'c' }])
  expect(ticketsRemaining(read)).toBe(2)
})
