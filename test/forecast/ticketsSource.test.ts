import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { finishedSinceFor, readQuery } from '../../src/forecast/finished.js'
import { inputsView, submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Tickets remaining's source (#211): following the tracker's latest read of the milestone query, or typed.

const TEAM = 'team'
const TODAY = '2026-11-12'
const READ_AT = '2026-11-12T09:00:00Z'
const NEXT_READ_AT = '2026-11-12T14:30:00Z'

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

const open = (...ids: string[]): Ticket[] => ids.map((id) => ({ id }))
const FINISHED: Ticket[] = [{ id: 'f1', finishedAt: '2026-10-20T10:00:00Z' }]

let fixture: CannedFixture
let dir: string
let storage: SqliteStorage
let using: Connecting
/** What the views read of the tracker: the team's connection and saved reads, in UTC. */
let tracker: TrackerReads

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-tickets-source-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  fixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
    reads: { [checkout.query]: { tickets: [...open('m1', 'm2', 'm3'), ...FINISHED], incomplete: false } },
  }
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    // the fixture as it is when read, so a test can change what the next read finds
    connector: () => cannedConnector(fixture),
  }
  tracker = { ...using, timeZone: 'UTC' }
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

async function connectGitHub(): Promise<void> {
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
}

/** The milestone, 30 tickets typed, at 4–8 a week, with its tickets picked in the Milestone step and read. */
async function enterAndPick(): Promise<void> {
  submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
  submit({ kind: 'setPaceRange', low: '4', high: '8' })
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
}

const submit = (edit: InputsEdit, reads: TrackerReads | undefined = tracker) =>
  submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit, { tracker: reads })

const inputs = (reads: TrackerReads | undefined = tracker) => inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker: reads })

const forecast = (reads: TrackerReads | undefined = tracker) => milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker: reads })

/** Reads the milestone query again at `readAt`, as a later read of the tracker does. */
async function readAgain(readAt: string): Promise<void> {
  await readQuery(cannedConnector(fixture), storage, { teamId: TEAM, query: checkout.query, finishedSince: finishedSinceFor(readAt), readAt })
}

describe('following the tracker', () => {
  beforeEach(async () => {
    await connectGitHub()
    await enterAndPick()
  })

  test('tickets remaining is typed until the EM chooses the tracker, which offers GitHub’s reading beside it', () => {
    expect(inputs().milestone.ticketsSource).toEqual({
      source: 'typed',
      tracker: 'GitHub',
      reading: { count: 3, incomplete: false, readOn: '12 Nov 09:00', readAt: READ_AT },
      readsDifferently: { unseen: true },
    })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })
  })

  test('following GitHub, tickets remaining is its latest read’s, which the forecast uses', () => {
    expect(submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })).toEqual({ saved: true, next: 'inputs' })

    expect(inputs().milestone.ticketsSource).toEqual({
      source: 'tracker',
      tracker: 'GitHub',
      reading: { count: 3, incomplete: false, readOn: '12 Nov 09:00', readAt: READ_AT },
    })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })
  })

  test('each read updates it, with no question asked', async () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    fixture.reads[checkout.query] = { tickets: open('m1', 'm2', 'm3', 'm4', 'm5'), incomplete: false }

    await readAgain(NEXT_READ_AT)

    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'tracker', reading: { count: 5, readOn: '12 Nov 14:30' } })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 5 })
  })

  test('saving the milestone’s name while following, with no tickets remaining on the form, keeps following', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(submit({ kind: 'setMilestone', name: 'Checkout v3', startDate: '2026-11-16', ticketsRemaining: undefined })).toEqual({ saved: true, next: 'inputs' })

    expect(inputs().milestone).toMatchObject({ name: 'Checkout v3', ticketsSource: { source: 'tracker' } })
    expect(forecast()).toMatchObject({ kind: 'forecast', name: 'Checkout v3', ticketsRemaining: 3 })
  })

  test('typing tickets remaining switches it to typed', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '40' })

    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'typed' })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 40 })
  })

  test('the typed value is kept while following, and back again once typed is chosen', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    expect(inputs().forms.milestone.ticketsRemaining).toBe('30')

    submit({ kind: 'setTicketsSource', ticketsSource: 'typed' })

    expect(inputs().milestone).toMatchObject({ ticketsRemaining: 30, ticketsSource: { source: 'typed' } })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })
  })

  test('a source that isn’t offered is refused, saying why', () => {
    const submitted = submit({ kind: 'setTicketsSource', ticketsSource: 'guess' })

    expect(submitted).toMatchObject({ saved: false, screen: 'inputs', view: { refusal: { form: 'ticketsSource', error: 'Choose GitHub or typed.' } } })
  })
})

describe('a read that can’t be followed', () => {
  beforeEach(connectGitHub)

  test('an incomplete read’s count is marked incomplete, and the forecast doesn’t use it as if whole', async () => {
    fixture.reads[checkout.query] = { tickets: open('m1', 'm2'), incomplete: true }
    await enterAndPick()

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    const why = 'GitHub gave only part of the milestone’s tickets, so tickets remaining isn’t known. Narrow the milestone query, or type tickets remaining.'
    expect(inputs().milestone).toMatchObject({
      ticketsSource: { source: 'tracker', reading: { count: 2, incomplete: true } },
      notes: [{ input: 'ticketsRemaining', message: why }],
    })
    expect(forecast()).toEqual({ kind: 'problems', name: 'Checkout v2', problems: [{ input: 'ticketsRemaining', message: why }] })
  })

  test('with the milestone’s tickets not read yet, there is no reading, and following it gives no forecast until there is', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(inputs().milestone.ticketsSource).toEqual({ source: 'tracker', tracker: 'GitHub', reading: undefined })
    expect(forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'ticketsRemaining', message: 'GitHub hasn’t read the milestone’s tickets yet. Pick them in the Milestone step, or type tickets remaining.' }],
    })
  })
})

describe('with no connection', () => {
  test('tickets remaining is typed, as in the MVP, with no source to choose', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' }, undefined)

    expect(inputs(undefined).milestone).toMatchObject({ ticketsRemaining: 30, ticketsSource: undefined })
  })

  test('the tracker can’t be chosen', () => {
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' }, undefined)

    expect(submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' }, undefined)).toMatchObject({
      saved: false,
      view: { refusal: { form: 'ticketsSource', error: 'Connect a tracker to follow it.' } },
    })
  })

  test('once disconnected, a milestone that followed the tracker forecasts from its typed tickets remaining', async () => {
    await connectGitHub()
    await enterAndPick()
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    await submitConnection(using, TEAM, { kind: 'disconnect' })

    expect(inputs().milestone.ticketsSource).toBeUndefined()
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })
  })
})

describe('on Jira', () => {
  const release: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'fixVersion = "Checkout v2"' }

  beforeEach(async () => {
    await submitConnection(using, TEAM, { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test', token: 'token' })
    fixture.reads[release.query] = { tickets: open('j1', 'j2'), incomplete: true }
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    await submitStepQuery(using, TEAM, { kind: 'addPick', choice: release }, READ_AT)
  })

  test('the sources and their wording name Jira', () => {
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })

    expect(inputs().milestone.ticketsSource).toMatchObject({ tracker: 'Jira' })
    expect(forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'ticketsRemaining', message: expect.stringMatching(/^Jira gave only part of the milestone’s tickets/) }],
    })
    expect(submit({ kind: 'setTicketsSource', ticketsSource: 'guess' })).toMatchObject({ view: { refusal: { error: 'Choose Jira or typed.' } } })
  })
})
