import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import type { ComparableWorkPace } from '../../src/forecast/comparableWorkPace.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { queryStepView, submitStepQuery, type QueryStepping } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// The Comparable work step's pace (#204): the pace in use, how far it is from the milestone's own, the two paired
// period by period, and each pick's own counts.

const TEAM = 'team'
const TODAY = '2026-11-12'
// Thursday; each read reaches back 9 weeks (8 whole weeks and the current one), to 09:00 on Thursday 10 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
const AT = { readAt: READ_AT, today: TODAY, timeZone: 'UTC' }

// The weeks both reads reach whole, from the milestone's start on Thursday 1 Oct: the weeks of 17 and 24 Sep, before
// it started, then six of its own; the current week, of 12 Nov, is left out.
const WEEKS = ['2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']

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
const shared: Choice = { kind: 'label', name: 'shared', query: 'label:"shared"' }

// the milestone's own: 0 before it started, then 3.5 a week over its six weeks
const OWN = [0, 0, 3, 4, 3, 4, 3, 4]
const SLOW = [2, 2, 2, 1, 2, 2, 1, 2]
const FAST = [5, 5, 6, 5, 6, 5, 6, 5]
const EVEN = [3, 3, 4, 3, 3, 4, 4, 3]
// two of slow's tickets, s1 and s2 (in the week of 17 Sep), and one of its own in the week of 15 Oct
const SHARED_TICKETS = [...finished('s', SLOW).slice(0, 2), { id: 'h1', finishedAt: '2026-10-16T10:00:00Z' }]

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
    [shared.query]: { tickets: SHARED_TICKETS, incomplete: false },
    [`${slow.query} OR ${shared.query}`]: { tickets: [{ id: 's-open' }, ...finished('s', SLOW), SHARED_TICKETS[2]!], incomplete: false },
  },
}

let dir: string
let storage: TeamStorage
let using: QueryStepping
let asked: string[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-comparable-pace-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    setup: storage,
    secrets: openMemorySecrets(),
    connector: () => {
      const canned = cannedConnector(FIXTURE)
      return { ...canned, read: (query, finishedSince) => (asked.push(query), canned.read(query, finishedSince)) }
    },
    milestoneInputs: storage,
    at: AT,
  }
  asked = []
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
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

function startOn(startDate: string): void {
  submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setMilestone', name: 'Checkout v2', startDate, ticketsRemaining: '30' })
}

const addComparable = (choice: Choice) => submitStepQuery(using, TEAM, { kind: 'addPick', choice }, READ_AT, COMPARABLE_WORK)

/** The pace the Comparable work step's view leads with. */
async function paceOf(): Promise<ComparableWorkPace | undefined> {
  const step = await queryStepView(using, TEAM, '', {}, COMPARABLE_WORK)
  return step.kind === 'comparableWorkStep' ? step.pace : undefined
}

describe('the pace in use', () => {
  test('comparable work slower than the milestone’s own: its median and range, and how far below the milestone’s own', async () => {
    await addComparable(slow)

    expect((await paceOf())).toMatchObject({
      inUse: { from: 'comparableWork', median: 2, low: 1, high: 2 },
      comparison: { versus: { kind: 'slower', by: 1.5 }, ownMedian: 3.5 },
      said: {
        inUse: '2 a week',
        from: 'pace, from comparable work, range 1–2',
        comparison: '↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)',
      },
    })
  })

  test('comparable work faster than the milestone’s own: how far above it', async () => {
    await addComparable(fast)

    expect((await paceOf())).toMatchObject({
      inUse: { from: 'comparableWork', median: 5, low: 5, high: 6 },
      comparison: { versus: { kind: 'faster', by: 1.5 }, ownMedian: 3.5 },
      said: { inUse: '5 a week', comparison: '↑ 1.5 a week faster than the milestone’s own so far (3.5 a week)' },
    })
  })

  test('within 0.5 a period of the milestone’s own, about the same', async () => {
    await addComparable(even)

    expect((await paceOf())).toMatchObject({
      comparison: { versus: { kind: 'aboutTheSame' }, ownMedian: 3.5 },
      said: { comparison: 'About the same as the milestone’s own so far (3.5 a week).' },
    })
  })

  test('with under 3 periods of its own, the milestone has too few to compare', async () => {
    startOn('2026-10-29')
    await addComparable(slow)

    expect((await paceOf())).toMatchObject({
      inUse: { from: 'comparableWork', median: 2 },
      comparison: { versus: { kind: 'tooFewToCompare' }, ownPeriods: 2 },
      said: { comparison: 'The milestone has 2 weeks of its own so far: too few to compare.' },
    })
  })

  test('with 3 periods of its own, the milestone is compared', async () => {
    startOn('2026-10-22')
    await addComparable(slow)

    expect((await paceOf())).toMatchObject({ comparison: { versus: { kind: 'slower', by: 2 }, ownMedian: 4 } })
  })

  test('with no comparable-work query, the milestone’s own is the headline, compared with nothing', async () => {
    const pace = (await paceOf())

    expect(pace).toMatchObject({
      inUse: { from: 'milestone', median: 3.5, low: 3, high: 4 },
      said: { inUse: '3.5 a week', from: 'pace, from the milestone’s own tickets, range 3–4' },
    })
    expect(pace?.comparison).toBeUndefined()
  })

  test('a comparable-work query matching nothing finished leaves the milestone’s own as the headline', async () => {
    await addComparable(idle)

    expect((await paceOf())).toMatchObject({ inUse: { from: 'milestone', median: 3.5 } })
    expect((await paceOf())?.comparison).toBeUndefined()
  })

  test('a comparable-work query finishing nothing in the periods pace counts is flagged as not used', async () => {
    await addComparable(idle)

    expect((await paceOf())?.flag).toBe(
      'This query matches nothing finished in the 8 whole weeks pace counts, so pace comes from the milestone’s own tickets. Check it picks out work like the milestone’s.',
    )
  })

  test('a comparable-work query in use, or none, is not flagged', async () => {
    expect((await paceOf())?.flag).toBeUndefined()

    await addComparable(slow)

    expect((await paceOf())?.flag).toBeUndefined()
  })

  test('a sprint’s pace is said a sprint', async () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setCadence', cadenceDays: '14' })
    await addComparable(slow)

    expect((await paceOf())?.said.comparison).toMatch(/a sprint slower than the milestone’s own so far \(.* a sprint\)$/)
  })

  test('none before the milestone query is read', async () => {
    await submitStepQuery(using, TEAM, { kind: 'removePick', query: checkout.query }, READ_AT)

    expect((await paceOf())).toBeUndefined()
  })
})

describe('the milestone query’s read incomplete', () => {
  test('pace comes from comparable work, compared with nothing, each period without the milestone’s own', async () => {
    const capped: CannedFixture = { ...FIXTURE, reads: { ...FIXTURE.reads, [checkout.query]: { tickets: finished('m', OWN), incomplete: true } } }
    using = { ...using, connector: () => cannedConnector(capped) }
    await submitStepQuery(using, TEAM, { kind: 'removePick', query: checkout.query }, READ_AT)
    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
    await addComparable(slow)

    const pace = (await paceOf())

    expect(pace).toMatchObject({ inUse: { from: 'comparableWork', median: 2 }, said: { inUse: '2 a week' } })
    expect(pace?.comparison).toBeUndefined()
    expect(pace?.periods).toEqual(WEEKS.map((start, at) => ({ start, comparableWork: SLOW[at], beforeStart: at <= 1 })))
  })
})

describe('the periods paired', () => {
  test('comparable work beside the milestone’s own in each period, those before the milestone started marked', async () => {
    await addComparable(slow)

    expect((await paceOf())?.periods).toEqual(
      WEEKS.map((start, at) => ({ start, milestone: OWN[at], comparableWork: SLOW[at], beforeStart: at <= 1 })),
    )
  })

  test('with no comparable-work query, the milestone’s own alone', async () => {
    expect((await paceOf())?.periods).toEqual(WEEKS.map((start, at) => ({ start, milestone: OWN[at], beforeStart: at <= 1 })))
  })

  test('the last 8 periods at most', async () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setCadence', cadenceDays: '3' })

    expect((await paceOf())?.periods).toHaveLength(8)
  })
})

describe('each pick', () => {
  test('one pick: its strip of the periods paired, and how many it finished', async () => {
    await addComparable(slow)

    expect((await paceOf())?.picks).toEqual([{ query: slow.query, strip: SLOW, finished: 14 }])
  })

  test('several picks: each one’s, and how many only it brings in; a ticket two share is only here for neither', async () => {
    await addComparable(slow)
    await addComparable(shared)

    expect((await paceOf())?.picks).toEqual([
      { query: slow.query, strip: SLOW, finished: 14, onlyHere: 12 },
      { query: shared.query, strip: [2, 0, 0, 0, 1, 0, 0, 0], finished: 3, onlyHere: 1 },
    ])
  })

  test('a pick whose own read is incomplete has no chip pace, and only-here is unknown for the rest', async () => {
    const capped: CannedFixture = { ...FIXTURE, reads: { ...FIXTURE.reads, [shared.query]: { tickets: SHARED_TICKETS, incomplete: true } } }
    using = { ...using, connector: () => cannedConnector(capped) }
    await addComparable(slow)
    await addComparable(shared)

    expect((await paceOf())?.picks).toEqual([{ query: slow.query, strip: SLOW, finished: 14 }])
  })

  test('removing a pick leaves the rest', async () => {
    await addComparable(slow)
    await addComparable(shared)
    await submitStepQuery(using, TEAM, { kind: 'removePick', query: slow.query }, READ_AT, COMPARABLE_WORK)

    expect((await paceOf())?.picks).toEqual([{ query: shared.query, strip: [2, 0, 0, 0, 1, 0, 0, 0], finished: 3 }])
  })
})

describe('what the tracker is asked', () => {
  test('nothing for the pace: it comes from the saved reads', async () => {
    await addComparable(slow)
    asked = []

    await paceOf()

    expect(asked).toEqual([])
  })

  test('with several picks, comparable work’s read also reads each pick, once', async () => {
    await addComparable(slow)
    asked = []

    await addComparable(shared)

    expect(asked).toEqual([`${slow.query} OR ${shared.query}`, slow.query, shared.query])
  })

  test('with one pick, its read is comparable work’s, read once', async () => {
    await addComparable(slow)

    expect(asked).toEqual([checkout.query, slow.query])
  })

  test('the milestone query’s picks are not read one by one', async () => {
    asked = []

    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: shared }, READ_AT)

    expect(asked).toEqual([`${checkout.query} OR ${shared.query}`])
  })
})
