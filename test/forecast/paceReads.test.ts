import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { submitInputs } from '../../src/forecast/inputs.js'
import { submitStepQuery, type StepReading } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { paceReads } from '../../src/forecast/paceReads.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// Where pace's finished tickets come from (#203): comparable work alone once it is added, else the milestone's own.

const TEAM = 'team'
const TODAY = '2026-11-12'
// Thursday; each read reaches back 9 weeks (8 whole weeks and the current one), to 09:00 on Thursday 10 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
const AT = { today: TODAY, timeZone: 'UTC' }

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const payments: Choice = { kind: 'label', name: 'payments', query: 'label:"payments"' }
const rewards: Choice = { kind: 'label', name: 'rewards', query: 'label:"rewards"' }
const edges: Choice = { kind: 'label', name: 'edges', query: 'label:"edges"' }

const MILESTONE_TICKETS = [
  { id: 'm1' },
  { id: 'm2' },
  { id: 'm3' },
  { id: 'm4', finishedAt: '2026-10-05T10:00:00Z' },
  { id: 'm5', finishedAt: '2026-10-06T10:00:00Z' },
  { id: 'm6', finishedAt: '2026-10-14T10:00:00Z' },
  { id: 'm7', finishedAt: '2026-11-06T10:00:00Z' },
]
const PAYMENTS_TICKETS = [
  { id: 'c1', finishedAt: '2026-09-25T10:00:00Z' },
  { id: 'c2', finishedAt: '2026-10-02T10:00:00Z' },
  { id: 'c3', finishedAt: '2026-10-20T10:00:00Z' },
  { id: 'c4', finishedAt: '2026-09-11T10:00:00Z' }, // read, but in a week the read reaches only part of
  { id: 'c5', finishedAt: '2026-11-12T08:00:00Z' }, // the current week
  { id: 'c9' }, // open: comparable work's open tickets are ignored
]

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [payments, rewards], pastLimit: false },
  ],
  reads: {
    [checkout.query]: { tickets: MILESTONE_TICKETS, incomplete: false },
    [payments.query]: { tickets: PAYMENTS_TICKETS, incomplete: false },
    // the tracker lists m4 under both parts here; it counts once
    [`${payments.query} OR ${checkout.query}`]: { tickets: [...PAYMENTS_TICKETS, ...MILESTONE_TICKETS, { id: 'm4', finishedAt: '2026-10-05T10:00:00Z' }], incomplete: false },
    [rewards.query]: { tickets: [{ id: 'r1' }], incomplete: false },
    // finished only in the week the read reaches part of, and in the current week: none in a whole week pace counts
    [edges.query]: { tickets: [PAYMENTS_TICKETS[3]!, PAYMENTS_TICKETS[4]!], incomplete: false },
  },
}

// The weeks both reads reach whole, from the milestone's start on Thursday 1 Oct: the weeks of 17 and 24 Sep, before
// it started, then six of its own; the current week, of 12 Nov, is left out.
const WEEKS = ['2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']
const MILESTONE_COUNTS = [0, 0, 2, 1, 0, 0, 0, 1]
const PAYMENTS_COUNTS = [0, 1, 1, 0, 1, 0, 0, 0]

let dir: string
let storage: TeamStorage
let using: StepReading

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-pace-reads-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({
    id: TEAM,
    name: 'My team',
    source: 'manual',
    sourceRef: '',
    installedAt: '2026-01-01T00:00:00Z',
  })
  using = {
    connections: storage,
    milestoneInputs: storage,
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
  submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, {
    kind: 'setMilestone',
    name: 'Checkout v2',
    startDate: '2026-10-01',
    ticketsRemaining: '30',
  })
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

const addComparable = (choice: Choice) => submitStepQuery(using, TEAM, { kind: 'addPick', choice }, READ_AT, COMPARABLE_WORK)

describe('with a comparable-work query', () => {
  test('pace comes from comparable work’s finished tickets alone: the milestone’s own that it doesn’t match aren’t counted', async () => {
    await addComparable(payments)

    expect(paceReads(storage, TEAM, AT)).toEqual({
      from: 'comparableWork',
      pace: { counts: PAYMENTS_COUNTS, starts: WEEKS },
      milestone: { counts: MILESTONE_COUNTS, starts: WEEKS },
      beforeStart: 2,
      comparableWork: { counts: PAYMENTS_COUNTS, starts: WEEKS },
      ticketsRemaining: 3,
    })
  })

  test('with the milestone picked in it too, its tickets count, each once', async () => {
    await addComparable(payments)
    await addComparable(checkout)

    expect(paceReads(storage, TEAM, AT)).toMatchObject({
      from: 'comparableWork',
      pace: { counts: [0, 1, 3, 1, 1, 0, 0, 1], starts: WEEKS },
      milestone: { counts: MILESTONE_COUNTS },
    })
  })

  test('tickets remaining come from the milestone query alone, never comparable work’s open tickets', async () => {
    await addComparable(payments)
    await addComparable(checkout)

    expect(paceReads(storage, TEAM, AT)).toMatchObject({ ticketsRemaining: 3 })
  })
})

describe('the milestone’s own pace', () => {
  const OWN = {
    from: 'milestone',
    pace: { counts: [2, 1, 0, 0, 0, 1], starts: WEEKS.slice(2) },
    milestone: { counts: MILESTONE_COUNTS, starts: WEEKS },
    beforeStart: 2,
    ticketsRemaining: 3,
  }

  test('with no comparable-work query, pace is the milestone’s own finished tickets, over the periods since its start', () => {
    expect(paceReads(storage, TEAM, AT)).toEqual({
      ...OWN,
      comparableWork: undefined,
    })
  })

  test('a comparable-work query matching nothing finished in the window isn’t used: pace falls back to the milestone’s own', async () => {
    await addComparable(rewards)

    expect(paceReads(storage, TEAM, AT)).toEqual({
      ...OWN,
      comparableWork: { counts: [0, 0, 0, 0, 0, 0, 0, 0], starts: WEEKS },
    })
  })

  test('a comparable-work query finishing only outside the whole periods pace counts isn’t used either', async () => {
    await addComparable(edges)

    expect(paceReads(storage, TEAM, AT)).toEqual({
      ...OWN,
      comparableWork: { counts: [0, 0, 0, 0, 0, 0, 0, 0], starts: WEEKS },
    })
  })

  test('a milestone started before the reads reach counts every period they reach whole', () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, {
      kind: 'setMilestone',
      name: 'Checkout v2',
      startDate: '2026-08-06',
      ticketsRemaining: '30',
    })

    expect(paceReads(storage, TEAM, AT)).toMatchObject({
      from: 'milestone',
      pace: { counts: MILESTONE_COUNTS, starts: WEEKS },
      beforeStart: 0,
    })
  })

  test('a milestone that starts in the current period has no periods of its own yet', () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, {
      kind: 'setMilestone',
      name: 'Checkout v2',
      startDate: '2026-11-10',
      ticketsRemaining: '30',
    })

    expect(paceReads(storage, TEAM, AT)).toMatchObject({
      from: 'milestone',
      pace: { counts: [], starts: [] },
      beforeStart: 8,
    })
  })
})

describe('no reads to count', () => {
  test('none before the milestone query is read', () => {
    storage.saveMilestoneQuery(TEAM, { picks: [], query: '' })

    expect(paceReads(storage, TEAM, AT)).toBeUndefined()
  })

  test('none while the milestone query’s read is incomplete', async () => {
    const partial: CannedFixture = {
      ...FIXTURE,
      reads: {
        [checkout.query]: { tickets: MILESTONE_TICKETS, incomplete: true },
      },
    }
    using = { ...using, connector: () => cannedConnector(partial) }
    storage.saveMilestoneQuery(TEAM, { picks: [], query: '' })
    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)

    expect(paceReads(storage, TEAM, AT)).toBeUndefined()
  })

  test('the milestone query’s read incomplete, pace still comes from comparable work’s; the milestone’s own and tickets remaining are unknown', async () => {
    const partial: CannedFixture = {
      ...FIXTURE,
      reads: {
        ...FIXTURE.reads,
        [checkout.query]: { tickets: MILESTONE_TICKETS, incomplete: true },
      },
    }
    using = { ...using, connector: () => cannedConnector(partial) }
    storage.saveMilestoneQuery(TEAM, { picks: [], query: '' })
    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
    await addComparable(payments)

    expect(paceReads(storage, TEAM, AT)).toEqual({
      from: 'comparableWork',
      pace: { counts: PAYMENTS_COUNTS, starts: WEEKS },
      milestone: undefined,
      beforeStart: 2,
      comparableWork: { counts: PAYMENTS_COUNTS, starts: WEEKS },
      ticketsRemaining: undefined,
    })
  })

  test('an incomplete comparable-work read isn’t counted: pace is the milestone’s own', async () => {
    const partial: CannedFixture = {
      ...FIXTURE,
      reads: {
        ...FIXTURE.reads,
        [payments.query]: { tickets: PAYMENTS_TICKETS, incomplete: true },
      },
    }
    using = { ...using, connector: () => cannedConnector(partial) }
    await addComparable(payments)

    expect(paceReads(storage, TEAM, AT)).toMatchObject({
      from: 'milestone',
      comparableWork: undefined,
    })
  })
})
