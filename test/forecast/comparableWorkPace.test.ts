import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { comparableWorkPace } from '../../src/forecast/comparableWorkPace.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { COMPARABLE_WORK, submitMilestoneQuery } from '../../src/forecast/milestoneStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// The Comparable work step's pace (#204): the pace in use, how far it is from the milestone's own, the two paired
// period by period, and each pick's own counts.

const TEAM = 'team'
const TODAY = '2026-11-12'
// Thursday; each read reaches back 8 weeks, to 09:00 on Thursday 17 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
const AT = { today: TODAY, timeZone: 'UTC' }

// The weeks both reads reach whole, from the milestone's start on Thursday 1 Oct: the week of 24 Sep, before it
// started, then six of its own; the current week, of 12 Nov, is left out.
const WEEKS = ['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']

/** Tickets finished `counts[i]` times in the week starting `WEEKS[i]`, on its Friday, with ids `prefix1`, `prefix2`… */
function finished(prefix: string, counts: number[]): Ticket[] {
  const friday = (week: string): string => `${week.slice(0, 8)}${String(Number(week.slice(8)) + 1).padStart(2, '0')}T10:00:00Z`
  let id = 0
  return counts.flatMap((count, week) => Array.from({ length: count }, () => ({ id: `${prefix}${++id}`, finishedAt: friday(WEEKS[week]!) })))
}

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const slow: Choice = { kind: 'label', name: 'slow', query: 'label:"slow"' }
const fast: Choice = { kind: 'label', name: 'fast', query: 'label:"fast"' }
const even: Choice = { kind: 'label', name: 'even', query: 'label:"even"' }
const idle: Choice = { kind: 'label', name: 'idle', query: 'label:"idle"' }

// the milestone's own: 0 before it started, then 3.5 a week over its six weeks
const OWN = [0, 3, 4, 3, 4, 3, 4]
const SLOW = [2, 2, 1, 2, 2, 1, 2]
const FAST = [5, 6, 5, 6, 5, 6, 5]
const EVEN = [3, 4, 3, 3, 4, 4, 3]

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [slow, fast, even, idle], pastLimit: false },
  ],
  reads: {
    [checkout.query]: { tickets: [{ id: 'm-open' }, ...finished('m', OWN)], incomplete: false },
    [slow.query]: { tickets: [{ id: 's-open' }, ...finished('s', SLOW)], incomplete: false },
    [fast.query]: { tickets: finished('f', FAST), incomplete: false },
    [even.query]: { tickets: finished('e', EVEN), incomplete: false },
    [idle.query]: { tickets: [{ id: 'i-open' }], incomplete: false },
  },
}

let dir: string
let storage: SqliteStorage
let using: Connecting

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-comparable-pace-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector(FIXTURE),
  }
  await submitConnection(using, TEAM, {
    kind: 'connect',
    tracker: 'github',
    repo: 'shop-team/shop',
    site: '',
    projectKey: '',
    email: '',
    token: 'token',
  })
  startOn('2026-10-01')
  await submitMilestoneQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

function startOn(startDate: string): void {
  submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setMilestone', name: 'Checkout v2', startDate, ticketsRemaining: '30' })
}

const addComparable = (choice: Choice) => submitMilestoneQuery(using, TEAM, { kind: 'addPick', choice }, READ_AT, COMPARABLE_WORK)

describe('the pace in use', () => {
  test('comparable work slower than the milestone’s own: its median and range, and how far below the milestone’s own', async () => {
    await addComparable(slow)

    expect(comparableWorkPace(storage, TEAM, AT)).toMatchObject({
      inUse: { from: 'comparableWork', median: 2, low: 1, high: 2 },
      comparison: { kind: 'slower', by: 1.5, own: 3.5 },
      said: {
        inUse: '2 a week',
        from: 'pace, from comparable work, range 1–2',
        comparison: '↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)',
      },
    })
  })

  test('comparable work faster than the milestone’s own: how far above it', async () => {
    await addComparable(fast)

    expect(comparableWorkPace(storage, TEAM, AT)).toMatchObject({
      inUse: { from: 'comparableWork', median: 5, low: 5, high: 6 },
      comparison: { kind: 'faster', by: 1.5, own: 3.5 },
      said: { inUse: '5 a week', comparison: '↑ 1.5 a week faster than the milestone’s own so far (3.5 a week)' },
    })
  })

  test('within 0.5 a period of the milestone’s own, about the same', async () => {
    await addComparable(even)

    expect(comparableWorkPace(storage, TEAM, AT)).toMatchObject({
      comparison: { kind: 'aboutTheSame', own: 3.5 },
      said: { comparison: 'About the same as the milestone’s own so far (3.5 a week).' },
    })
  })

  test('with under 3 periods of its own, the milestone has too few to compare', async () => {
    startOn('2026-10-29')
    await addComparable(slow)

    expect(comparableWorkPace(storage, TEAM, AT)).toMatchObject({
      inUse: { from: 'comparableWork', median: 2 },
      comparison: { kind: 'tooFew', ownPeriods: 2 },
      said: { comparison: 'The milestone has 2 weeks of its own so far: too few to compare.' },
    })
  })

  test('with 3 periods of its own, the milestone is compared', async () => {
    startOn('2026-10-22')
    await addComparable(slow)

    expect(comparableWorkPace(storage, TEAM, AT)).toMatchObject({ comparison: { kind: 'slower', by: 2, own: 4 } })
  })

  test('with no comparable-work query, the milestone’s own is the headline, compared with nothing', () => {
    const pace = comparableWorkPace(storage, TEAM, AT)

    expect(pace).toMatchObject({
      inUse: { from: 'milestone', median: 3.5, low: 3, high: 4 },
      said: { inUse: '3.5 a week', from: 'pace, from the milestone’s own tickets, range 3–4' },
    })
    expect(pace?.comparison).toBeUndefined()
  })

  test('a comparable-work query matching nothing finished leaves the milestone’s own as the headline', async () => {
    await addComparable(idle)

    expect(comparableWorkPace(storage, TEAM, AT)).toMatchObject({ inUse: { from: 'milestone', median: 3.5 } })
    expect(comparableWorkPace(storage, TEAM, AT)?.comparison).toBeUndefined()
  })

  test('a sprint’s pace is said a sprint', async () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setCadence', cadenceDays: '14' })
    await addComparable(slow)

    expect(comparableWorkPace(storage, TEAM, AT)?.said.comparison).toMatch(/a sprint slower than the milestone’s own so far \(.* a sprint\)$/)
  })

  test('none before the milestone query is read', async () => {
    await submitMilestoneQuery(using, TEAM, { kind: 'removePick', query: checkout.query }, READ_AT)

    expect(comparableWorkPace(storage, TEAM, AT)).toBeUndefined()
  })
})

describe('the periods paired', () => {
  test('comparable work beside the milestone’s own in each period, those before the milestone started marked', async () => {
    await addComparable(slow)

    expect(comparableWorkPace(storage, TEAM, AT)?.periods).toEqual(
      WEEKS.map((start, at) => ({ start, milestone: OWN[at], comparableWork: SLOW[at], beforeStart: at === 0 })),
    )
  })

  test('with no comparable-work query, the milestone’s own alone', () => {
    expect(comparableWorkPace(storage, TEAM, AT)?.periods).toEqual(WEEKS.map((start, at) => ({ start, milestone: OWN[at], beforeStart: at === 0 })))
  })

  test('the last 8 periods at most', () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setCadence', cadenceDays: '3' })

    expect(comparableWorkPace(storage, TEAM, AT)?.periods).toHaveLength(8)
  })
})
