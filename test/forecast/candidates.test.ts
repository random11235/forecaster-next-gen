import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Connector, Ticket } from '../../src/connectors/connector.js'
import { narrowedToAFew, openCandidates, type Candidates } from '../../src/forecast/candidates.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { COMPARABLE_WORK, milestoneStepView, searchedChoiceList, submitMilestoneQuery } from '../../src/forecast/milestoneStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Candidates for comparable work (#205): read on demand, each grouped slower, about the same or faster than the
// milestone's own, or nothing finished.

const TEAM = 'team'
const TODAY = '2026-11-12'
// Thursday; each read reaches back 8 weeks, to 09:00 on Thursday 17 Sep, so the weeks it reaches whole start on 24 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
const AT = { readAt: READ_AT, today: TODAY, timeZone: 'UTC' }
const WEEKS = ['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const payments: Choice = { kind: 'label', name: 'payments', query: 'label:"payments"' }
const rewards: Choice = { kind: 'label', name: 'rewards', query: 'label:"rewards"' }
const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }
const docs: Choice = { kind: 'label', name: 'docs', query: 'label:"docs"' }
const broken: Choice = { kind: 'label', name: 'broken', query: 'label:"broken"' }
const partial: Choice = { kind: 'label', name: 'partial', query: 'label:"partial"' }
const loyalty: Choice = { kind: 'label', name: 'loyalty', query: 'label:"loyalty"' }
const release: Choice = { kind: 'label', name: 'release', query: 'label:"release"' }
const refunds: Choice = { kind: 'label', name: 'refunds', query: 'label:"refunds"' }

/** Tickets `prefix`1… finished at 10:00 on the Friday of each week in `WEEKS`, `counts[week]` of them. */
function finishedIn(prefix: string, counts: number[]): Ticket[] {
  let n = 0
  return counts.flatMap((count, week) =>
    Array.from({ length: count }, () => ({ id: `${prefix}${++n}`, finishedAt: `${addDays(WEEKS[week]!, 1)}T10:00:00Z` })),
  )
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

// The milestone started on 1 Oct: six weeks of its own, 2 a week at the median.
const MILESTONE_TICKETS = [{ id: 'm-open1' }, { id: 'm-open2' }, ...finishedIn('m', [0, 2, 2, 1, 2, 3, 2])]
const PAYMENTS_TICKETS = [{ id: 'p-open' }, ...finishedIn('p', [1, 1, 0, 1, 1, 0, 1])]
const REWARDS_TICKETS = finishedIn('r', [2, 2, 2, 3, 1, 2, 2])
// three of rewards' tickets, and two of its own
const LOYALTY_TICKETS = [...REWARDS_TICKETS.slice(0, 3), ...finishedIn('l', [0, 0, 0, 0, 0, 1, 1])]
const BUG_TICKETS = [{ id: 'b-open1' }, { id: 'b-open2' }, { id: 'b-open3' }, ...finishedIn('b', [4, 4, 5, 4, 3, 4, 4])]

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [payments, rewards, bug, docs, broken, partial, loyalty, release, refunds], pastLimit: false },
  ],
  reads: {
    [checkout.query]: { tickets: MILESTONE_TICKETS, incomplete: false },
    [payments.query]: { tickets: PAYMENTS_TICKETS, incomplete: false },
    [rewards.query]: { tickets: REWARDS_TICKETS, incomplete: false },
    [bug.query]: { tickets: BUG_TICKETS, incomplete: false },
    [docs.query]: { tickets: [{ id: 'd-open1' }, { id: 'd-open2' }], incomplete: false },
    [broken.query]: { failure: 'unavailable' },
    [partial.query]: { tickets: REWARDS_TICKETS, incomplete: true },
    [loyalty.query]: { tickets: LOYALTY_TICKETS, incomplete: false },
  },
}

let dir: string
let storage: SqliteStorage
let using: Connecting
let reads: string[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-candidates-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  reads = []
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    connector: () => counted(cannedConnector(FIXTURE)),
  }
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
  submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-01', ticketsRemaining: '30' })
  await submitMilestoneQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
  reads = []
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

/** The connector, noting each query it reads in `reads`. */
function counted(connector: Connector): Connector {
  return { ...connector, read: (query, finishedSince) => (reads.push(query), connector.read(query, finishedSince)) }
}

const open = () => openCandidates(using, storage, TEAM, AT)

/** Each group's candidates, by name. */
const named = (candidates: Candidates) => candidates.groups.map(({ group, candidates }) => ({ group, names: candidates.map((each) => each.choice.name) }))

describe('a candidate’s read', () => {
  test('its last periods as a strip, its median and how it compares with the milestone’s own, finished, open and last finished', async () => {
    const candidates = await open().read([payments])

    expect(candidates.groups).toEqual([
      {
        group: 'slower',
        candidates: [
          {
            choice: payments,
            thisMilestone: false,
            read: {
              strip: { counts: [1, 1, 0, 1, 1, 0, 1], starts: WEEKS },
              median: 1,
              versus: { kind: 'slower', by: 1 },
              finished: 5,
              lastFinished: '2026-11-06',
              open: 1,
            },
          },
        ],
      },
    ])
    expect(candidates.milestoneOwn).toBe(2)
  })

  test('grouped slower, about the same, faster and nothing finished, each by median; the milestone itself marked', async () => {
    const candidates = await open().read([bug, docs, checkout, payments, rewards])

    expect(named(candidates)).toEqual([
      { group: 'slower', names: ['payments'] },
      { group: 'aboutTheSame', names: ['Checkout v2', 'rewards'] },
      { group: 'faster', names: ['bug'] },
      { group: 'nothingFinished', names: ['docs'] },
    ])
    const milestone = candidates.groups[1]!.candidates[0]!
    expect(milestone.thisMilestone).toBe(true)
    expect(candidates.groups[2]!.candidates[0]).toMatchObject({ read: { median: 4, versus: { kind: 'faster', by: 2 }, open: 3 } })
    expect(candidates.groups[3]!.candidates[0]).toMatchObject({ read: { finished: 0, open: 2 } })
    expect(candidates.groups[3]!.candidates[0]).not.toHaveProperty(['read', 'lastFinished'])
  })

  test('how many it adds that the picks don’t already count', async () => {
    await submitMilestoneQuery(using, TEAM, { kind: 'addPick', choice: rewards }, READ_AT, COMPARABLE_WORK)

    const candidates = await open().read([loyalty])

    expect(candidates.groups[0]!.candidates[0]).toMatchObject({ read: { finished: 5, adds: 2 } })
  })

  test('with no comparable work picked, adds is left out', async () => {
    const candidates = await open().read([bug])

    expect(candidates.groups[0]!.candidates[0]).not.toHaveProperty(['read', 'adds'])
  })

  test('with too few periods of the milestone’s own to compare, listed by median, slowest first', async () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-10-29', ticketsRemaining: '30' })

    const candidates = await open().read([bug, docs, payments, rewards])

    expect(candidates.milestoneOwn).toBeUndefined()
    expect(named(candidates)).toEqual([
      { group: 'byMedian', names: ['payments', 'rewards', 'bug'] },
      { group: 'nothingFinished', names: ['docs'] },
    ])
    expect(candidates.groups[0]!.candidates[0]).toMatchObject({ read: { versus: { kind: 'tooFewToCompare' } } })
  })

  test('a read that fails shows why, and the candidate is still there to pick', async () => {
    const candidates = await open().read([broken, partial])

    expect(candidates.groups).toEqual([
      {
        group: 'readFailed',
        candidates: [
          { choice: broken, thisMilestone: false, failure: 'GitHub couldn’t read it just now. Open it again in a few minutes.' },
          { choice: partial, thisMilestone: false, failure: 'GitHub gave only part of what it matches, so it isn’t counted.' },
        ],
      },
    ])
  })
})

describe('this milestone, in the step’s lists', () => {
  test('the choice that is the milestone query is marked, without reading it', async () => {
    const step = await milestoneStepView(using, TEAM, '', {}, COMPARABLE_WORK)
    const searched = await searchedChoiceList(using, TEAM, 'milestone', '', COMPARABLE_WORK)

    expect(step.kind === 'milestoneStep' && step.lists.map((list) => list.thisMilestone)).toEqual([checkout.query, undefined])
    expect(searched).toMatchObject({ thisMilestone: checkout.query })
    expect(reads).toEqual([])
  })

  test('none is marked when the milestone query is more than one choice', async () => {
    await submitMilestoneQuery(using, TEAM, { kind: 'addPick', choice: release }, READ_AT)

    const step = await milestoneStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(step.kind === 'milestoneStep' && step.lists.map((list) => list.thisMilestone)).toEqual([undefined, undefined])
  })
})

describe('reading on demand', () => {
  test('opening the step reads no candidate', async () => {
    open()
    await milestoneStepView(using, TEAM, '', {}, COMPARABLE_WORK)

    expect(reads).toEqual([])
  })

  test('opening one candidate reads only it', async () => {
    await open().read([payments])

    expect(reads).toEqual([payments.query])
  })

  test('each is read at most once per opening, and kept for the opening', async () => {
    const opening = open()
    await opening.read([payments])
    const candidates = await opening.read([payments, rewards])

    expect(reads).toEqual([payments.query, rewards.query])
    expect(named(candidates)).toEqual([
      { group: 'slower', names: ['payments'] },
      { group: 'aboutTheSame', names: ['rewards'] },
    ])
  })

  test('a new opening reads afresh', async () => {
    await open().read([payments])
    await open().read([payments])

    expect(reads).toEqual([payments.query, payments.query])
  })

  test('narrowing to a few by typing reads only those', async () => {
    const step = await milestoneStepView(using, TEAM, 'r', {}, COMPARABLE_WORK)
    if (step.kind !== 'milestoneStep') throw new Error('no step')

    await open().read(narrowedToAFew(step.lists, step.find))

    expect(reads).toEqual([rewards.query, broken.query, partial.query, release.query, refunds.query])
  })

  test('typing that leaves more than a few, or nothing typed, reads nothing', async () => {
    const step = await milestoneStepView(using, TEAM, '', {}, COMPARABLE_WORK)
    if (step.kind !== 'milestoneStep') throw new Error('no step')
    const wide = await milestoneStepView(using, TEAM, 'e', {}, COMPARABLE_WORK)
    if (wide.kind !== 'milestoneStep') throw new Error('no step')

    expect(narrowedToAFew(step.lists, step.find)).toEqual([])
    expect(narrowedToAFew(wide.lists, wide.find)).toEqual([])
  })
})
