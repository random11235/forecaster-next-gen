import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { finishedSinceFor, readQuery } from '../../src/forecast/finished.js'
import { inputsView, submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { submitStepQuery, type StepReading } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// A typed value the tracker reads differently (#215): its chip, the dot on it for a read the EM hasn't opened, and
// Follow, which switches the value back to the tracker. Mirrors the prototype's `handNew` scenario.

const TEAM = 'team'
// Thursday; the read reaches back 8 weeks, to 09:00 on Thursday 17 Sep.
const TODAY = '2026-11-12'
const READ_AT = '2026-11-12T09:00:00Z'
const NEXT_READ_AT = '2026-11-12T14:30:00Z'
const START = '2026-08-31'

// The weeks the read reaches whole, from Monday 21 Sep; the current week, of 9 Nov, is left out.
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] =>
  counts.flatMap((count, week) => Array.from({ length: count }, (_, i) => ({ id: `w-${week}-${i}`, finishedAt: `${addDay(WEEKS[week]!)}T10:00:00Z` })))

const open = (count: number): Ticket[] => Array.from({ length: count }, (_, i) => ({ id: `o${i}` }))

// GitHub reads 34 tickets remaining, and 5, 6, 4, 7, 5, 6, 8 finished in the weeks it reads whole
const GITHUB_COUNTS = [5, 6, 4, 7, 5, 6, 8]

let fixture: CannedFixture
let dir: string
let storage: SqliteStorage
let using: StepReading
let tracker: TrackerReads

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-reads-differently-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  fixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
    reads: { [checkout.query]: { tickets: [...open(34), ...finishedInWeeks(GITHUB_COUNTS)], incomplete: false } },
  }
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    milestoneInputs: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector(fixture),
  }
  tracker = { ...using, timeZone: 'UTC' }
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

const submit = (edit: InputsEdit, reads: TrackerReads | undefined = tracker) => submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit, { tracker: reads })

const inputs = (reads: TrackerReads | undefined = tracker) => inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker: reads })

const forecast = () => milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker })

async function connect(to: 'github' | 'jira' = 'github'): Promise<void> {
  const where =
    to === 'github'
      ? { tracker: 'github' as const, repo: 'shop-team/shop', site: '', projectKey: '', email: '' }
      : { tracker: 'jira' as const, repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test' }
  await submitConnection(using, TEAM, { kind: 'connect', ...where, token: 'token' })
}

/** The milestone, `ticketsRemaining` typed, with typed counts and a range kept, its tickets picked and read. */
async function enterAndPick(ticketsRemaining = '40'): Promise<void> {
  submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining })
  submit({ kind: 'setPaceRange', low: '4', high: '8' })
  submit({ kind: 'setPaceCounts', counts: '5, 6, 4, 7, 5, 6' })
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
}

/** Reads the milestone query again at `readAt`, as a later read of the tracker does. */
async function readAgain(readAt: string): Promise<void> {
  await readQuery(cannedConnector(fixture), storage, { teamId: TEAM, query: checkout.query, finishedSince: finishedSinceFor(readAt), readAt })
}

describe('tickets remaining', () => {
  beforeEach(async () => {
    await connect()
    await enterAndPick()
  })

  test('typed and different from GitHub’s reading, it carries the chip, with the dot for a read not yet opened', () => {
    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'typed', reading: { count: 34 }, readsDifferently: { unseen: true } })
  })

  test('typed the same as GitHub’s reading, it carries no chip', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '34' })

    expect(inputs().milestone.ticketsSource?.readsDifferently).toBeUndefined()
  })

  test('following GitHub, it carries no chip', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(inputs().milestone.ticketsSource?.readsDifferently).toBeUndefined()
  })

  test('opening the reading clears the dot, which returns with a new read', async () => {
    expect(submit({ kind: 'openReading', reading: 'ticketsRemaining' })).toEqual({ saved: true, next: 'inputs' })
    expect(inputs().milestone.ticketsSource?.readsDifferently).toEqual({ unseen: false })

    fixture.reads[checkout.query] = { tickets: open(38), incomplete: false }
    await readAgain(NEXT_READ_AT)

    expect(inputs().milestone.ticketsSource).toMatchObject({ reading: { count: 38 }, readsDifferently: { unseen: true } })
  })

  test('Follow switches it back to GitHub, keeping the typed value', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 34 })
    submit({ kind: 'setTicketsSource', ticketsSource: 'typed' })
    expect(inputs().milestone).toMatchObject({ ticketsRemaining: 40, ticketsSource: { readsDifferently: { unseen: true } } })
  })
})

describe('pace', () => {
  beforeEach(async () => {
    await connect()
    await enterAndPick()
  })

  test('typed counts different from GitHub’s carry the chip, with its dot', () => {
    submit({ kind: 'setPaceMode', paceMode: 'counts' })

    expect(inputs().milestone.trackerPace).toMatchObject({ reading: { counts: GITHUB_COUNTS }, readsDifferently: { unseen: true } })
  })

  test('typed counts the same as GitHub’s carry no chip', () => {
    submit({ kind: 'setPaceMode', paceMode: 'counts' })
    submit({ kind: 'setPaceCounts', counts: GITHUB_COUNTS.join(', ') })

    expect(inputs().milestone.trackerPace?.readsDifferently).toBeUndefined()
  })

  test('a range other than the span of GitHub’s counts carries the chip; one spanning them, 4 to 8, carries none', () => {
    expect(inputs().milestone).toMatchObject({ paceMode: 'range', paceRange: { low: 4, high: 8 } })
    expect(inputs().milestone.trackerPace?.readsDifferently).toBeUndefined()

    submit({ kind: 'setPaceRange', low: '4', high: '9' })

    expect(inputs().milestone.trackerPace?.readsDifferently).toEqual({ unseen: true })
  })

  test('following GitHub, pace carries no chip', () => {
    submit({ kind: 'setPaceMode', paceMode: 'tracker' })

    expect(inputs().milestone.trackerPace?.readsDifferently).toBeUndefined()
  })

  test('opening the reading clears the dot, which returns with a new read', async () => {
    submit({ kind: 'setPaceMode', paceMode: 'counts' })

    submit({ kind: 'openReading', reading: 'pace' })
    expect(inputs().milestone.trackerPace?.readsDifferently).toEqual({ unseen: false })
    // opening pace’s reading leaves tickets remaining’s dot
    expect(inputs().milestone.ticketsSource?.readsDifferently).toEqual({ unseen: true })

    await readAgain(NEXT_READ_AT)
    expect(inputs().milestone.trackerPace?.readsDifferently).toEqual({ unseen: true })
  })

  test('Follow switches pace back to GitHub, keeping the typed counts and the range', () => {
    submit({ kind: 'setPaceMode', paceMode: 'counts' })

    submit({ kind: 'setPaceMode', paceMode: 'tracker' })

    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', counts: GITHUB_COUNTS } })
    expect(inputs().milestone).toMatchObject({ paceCounts: [5, 6, 4, 7, 5, 6], paceRange: { low: 4, high: 8 } })
  })
})

describe('a reading that can’t be opened', () => {
  test('with no connection, there is no chip, and opening a reading is refused', async () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' }, undefined)

    expect(inputs(undefined).milestone).toMatchObject({ ticketsSource: undefined, trackerPace: undefined })
    expect(submit({ kind: 'openReading', reading: 'ticketsRemaining' }, undefined)).toMatchObject({
      saved: false,
      view: { refusal: { form: 'readingOpened', error: 'Connect a tracker to see its reading.' } },
    })
  })

  test('before the milestone’s tickets are read, there is no chip', async () => {
    await connect()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })

    expect(inputs().milestone.ticketsSource?.readsDifferently).toBeUndefined()
    expect(submit({ kind: 'openReading', reading: 'ticketsRemaining' })).toMatchObject({
      saved: false,
      view: { refusal: { form: 'readingOpened', error: 'GitHub hasn’t read it yet.' } },
    })
  })
})

describe('on Jira', () => {
  test('the chip’s reading and Follow name Jira', async () => {
    await connect('jira')
    const release: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'fixVersion = "Checkout v2"' }
    fixture.reads[release.query] = { tickets: open(12), incomplete: false }
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '40' })
    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: release }, READ_AT)

    expect(inputs().milestone.ticketsSource).toMatchObject({ tracker: 'Jira', readsDifferently: { unseen: true } })
  })
})
