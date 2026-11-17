import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned.js'
import type { Choice } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { inputsView, submitInputs } from '../../src/forecast/inputs.js'
import { queryStepView, submitStepQuery, type ComparableWorkStep, type StepReading } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { TeamStorage } from '../trackerScenario.js'

// Where pace's finished tickets come from (#203): comparable work alone once it is added, else the milestone's own,
// as the Comparable work step pairs the two reads period by period and leads with the pace in use.

const TEAM = 'team'
const TODAY = '2026-11-12'
// Thursday; each read reaches back 9 weeks (8 whole weeks and the current one), to 09:00 on Thursday 10 Sep.
const READ_AT = '2026-11-12T09:00:00Z'
const AT = { readAt: READ_AT, today: TODAY, timeZone: 'UTC' }

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
    [`${payments.query} OR ${checkout.query}`]: {
      tickets: [...PAYMENTS_TICKETS, ...MILESTONE_TICKETS, { id: 'm4', finishedAt: '2026-10-05T10:00:00Z' }],
      incomplete: false,
    },
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
  storage.saveSetupState(TEAM, { open: false, closed: 'done' })
  using = {
    connections: storage,
    milestoneInputs: storage,
    queries: storage,
    setup: storage,
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

/** The pace the Comparable work step leads with, from the team's saved reads. */
async function stepPace(): Promise<ComparableWorkStep['pace']> {
  const step = await queryStepView({ ...using, at: AT }, TEAM, '', {}, COMPARABLE_WORK)
  return step.kind === 'comparableWorkStep' ? step.pace : undefined
}

/** The weeks paired, each with the two reads' counts, as the step pairs them: none for a read it has no counts of. */
function paired({ milestone, comparableWork }: { milestone?: number[]; comparableWork?: number[] }, beforeStart = 2) {
  return WEEKS.map((start, at) => ({
    start,
    ...(milestone && { milestone: milestone[at] }),
    ...(comparableWork && { comparableWork: comparableWork[at] }),
    beforeStart: at < beforeStart,
  }))
}

describe('with a comparable-work query', () => {
  test('pace comes from comparable work’s finished tickets alone: the milestone’s own that it doesn’t match aren’t counted', async () => {
    await addComparable(payments)

    expect(await stepPace()).toMatchObject({
      inUse: { from: 'comparableWork', median: 0, low: 0, high: 1 },
      periods: paired({ milestone: MILESTONE_COUNTS, comparableWork: PAYMENTS_COUNTS }),
    })
  })

  test('with the milestone picked in it too, its tickets count, each once', async () => {
    await addComparable(payments)
    await addComparable(checkout)

    expect(await stepPace()).toMatchObject({
      inUse: { from: 'comparableWork', median: 1, low: 0, high: 3 },
      periods: paired({ milestone: MILESTONE_COUNTS, comparableWork: [0, 1, 3, 1, 1, 0, 0, 1] }),
    })
  })

  test('tickets remaining come from the milestone query alone, never comparable work’s open tickets', async () => {
    await addComparable(payments)
    await addComparable(checkout)

    const tracker = { ...using, timeZone: 'UTC' }
    expect(inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker }).milestone.ticketsSource).toMatchObject({ reading: { count: 3 } })
  })

  test('with the milestone query’s read incomplete, tickets remaining aren’t known, though comparable work’s read is complete', async () => {
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

    const tracker = { ...using, timeZone: 'UTC' }
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, { kind: 'setTicketsSource', ticketsSource: 'tracker' }, { tracker })
    const why = 'GitHub gave only part of the milestone’s tickets, so tickets remaining isn’t known. Narrow the milestone query, or type tickets remaining.'
    expect(inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker }).milestone.notes).toContainEqual({ input: 'ticketsRemaining', message: why })
  })
})

describe('the milestone’s own pace', () => {
  // its six weeks since its start, 1 Oct: 2, 1, 0, 0, 0, 1
  const OWN = { from: 'milestone', median: 0.5, low: 0, high: 2 }

  test('with no comparable-work query, pace is the milestone’s own finished tickets, over the periods since its start', async () => {
    const pace = await stepPace()
    expect(pace).toMatchObject({ inUse: OWN })
    // exactly: no comparable work beside the milestone's own
    expect(pace?.periods).toEqual(paired({ milestone: MILESTONE_COUNTS }))
    expect(pace?.flag).toBeUndefined()
  })

  test('a comparable-work query matching nothing finished in the window isn’t used: pace falls back to the milestone’s own', async () => {
    await addComparable(rewards)

    expect(await stepPace()).toMatchObject({
      inUse: OWN,
      periods: paired({ milestone: MILESTONE_COUNTS, comparableWork: [0, 0, 0, 0, 0, 0, 0, 0] }),
      flag: expect.stringContaining('nothing finished in the 8 whole weeks pace counts'),
    })
  })

  test('a comparable-work query finishing only outside the whole periods pace counts isn’t used either', async () => {
    await addComparable(edges)

    expect(await stepPace()).toMatchObject({
      inUse: OWN,
      periods: paired({ milestone: MILESTONE_COUNTS, comparableWork: [0, 0, 0, 0, 0, 0, 0, 0] }),
      flag: expect.stringContaining('nothing finished in the 8 whole weeks pace counts'),
    })
  })

  test('a milestone started before the reads reach counts every period they reach whole', async () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, {
      kind: 'setMilestone',
      name: 'Checkout v2',
      startDate: '2026-08-06',
      ticketsRemaining: '30',
    })

    expect(await stepPace()).toMatchObject({
      inUse: { from: 'milestone', median: 0, low: 0, high: 2 },
      periods: paired({ milestone: MILESTONE_COUNTS }, 0),
    })
  })

  test('a milestone that starts in the current period has no periods of its own yet', async () => {
    submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, {
      kind: 'setMilestone',
      name: 'Checkout v2',
      startDate: '2026-11-10',
      ticketsRemaining: '30',
    })

    const pace = await stepPace()
    expect(pace?.inUse).toBeUndefined()
    expect(pace?.periods).toHaveLength(8)
    expect(pace?.periods.every((period) => period.beforeStart)).toBe(true)
  })
})

describe('no reads to count', () => {
  test('none before the milestone query is read', async () => {
    storage.saveMilestoneQuery(TEAM, { picks: [], query: '' })

    expect(await stepPace()).toBeUndefined()
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

    expect(await stepPace()).toBeUndefined()
  })

  test('the milestone query’s read incomplete, pace still comes from comparable work’s; the milestone’s own is unknown', async () => {
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

    const pace = await stepPace()
    expect(pace).toMatchObject({ inUse: { from: 'comparableWork', median: 0, low: 0, high: 1 } })
    // exactly: the milestone's own counts are unknown, so none are paired, nor compared with
    expect(pace?.periods).toEqual(paired({ comparableWork: PAYMENTS_COUNTS }))
    expect(pace?.comparison).toBeUndefined()
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

    const pace = await stepPace()
    expect(pace).toMatchObject({ inUse: { from: 'milestone' } })
    // exactly: comparable work's incomplete read pairs nothing, and isn't flagged as not used
    expect(pace?.periods).toEqual(paired({ milestone: MILESTONE_COUNTS }))
    expect(pace?.flag).toBeUndefined()
  })
})
