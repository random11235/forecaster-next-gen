import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { submitConnection, type Connecting } from '../../src/forecast/connection.js'
import { inputsView, submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Pace following the tracker (#212): up to the 8 most recent whole periods it reads, the current one left out, quiet
// ones 0, leaving out quiet periods before the first finished ticket.

const TEAM = 'team'
// Thursday; the read reaches back 8 weeks, to 09:00 on Thursday 17 Sep.
const TODAY = '2026-11-12'
const READ_AT = '2026-11-12T09:00:00Z'
// a Monday, long before the read reaches, so the milestone's own pace counts every week the read reaches whole
const START = '2026-08-31'

// The weeks the read reaches whole, from Monday 21 Sep; the current week, of 9 Nov, is left out.
const WEEKS = ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

/** `count` tickets finished at 10:00 on `day`, with ids from `prefix`. */
const finishedOn = (prefix: string, day: string, count: number): Ticket[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${day}-${i}`, finishedAt: `${day}T10:00:00Z` }))

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] => counts.flatMap((count, week) => finishedOn('w', addDay(WEEKS[week]!), count))

const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

const OFFLINE = { connected: false }

const OPEN: Ticket[] = [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }]

let fixture: CannedFixture
let dir: string
let storage: SqliteStorage
let using: Connecting
let tracker: TrackerReads

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-tracker-pace-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  fixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
    reads: { [checkout.query]: { tickets: [...OPEN, ...finishedInWeeks([5, 6, 4, 7, 5, 6, 8])], incomplete: false } },
  }
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    connector: () => cannedConnector(fixture),
  }
  tracker = { ...using, timeZone: 'UTC' }
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

// each as the local server build shows it, with the tracker's reads; `{ connected: false }` as the browser build does
const reading = ({ connected = true } = {}) => ({ tracker: connected ? tracker : undefined })

const submit = (edit: InputsEdit, options?: { connected: boolean }) => submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit, reading(options))

const inputs = (options?: { connected: boolean }) => inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, reading(options))

const forecast = (options?: { connected: boolean }) => milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, reading(options))

async function connectGitHub(): Promise<void> {
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
}

/** The milestone at `cadenceDays`, with a pace range and typed counts kept, its tickets picked and read. */
async function enterAndPick({ cadenceDays = '7' } = {}): Promise<void> {
  submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  submit({ kind: 'setCadence', cadenceDays })
  submit({ kind: 'setPaceRange', low: '4', high: '8' })
  submit({ kind: 'setPaceCounts', counts: '1, 2, 3, 4' })
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
}

describe('following GitHub', () => {
  beforeEach(async () => {
    await connectGitHub()
  })

  test('pace can follow GitHub: its counts of the weeks it reads whole, the current one left out, which the forecast uses', async () => {
    await enterAndPick()

    expect(submit({ kind: 'setPaceMode', paceMode: 'tracker' })).toEqual({ saved: true, next: 'forecast' })

    expect(inputs().milestone).toMatchObject({
      paceMode: 'tracker',
      paceSource: {
        tracker: 'GitHub',
        reading: {
          window: { counts: [5, 6, 4, 7, 5, 6, 8], starts: WEEKS },
          periods: '7 weeks · GitHub has nothing before w/c 21 Sep',
          firstFinished: undefined,
          readOn: '12 Nov 09:00',
        },
      },
    })
    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', tracker: 'GitHub', counts: [5, 6, 4, 7, 5, 6, 8] } })
  })
})

describe('the window', () => {
  beforeEach(async () => {
    await connectGitHub()
  })

  /** Reads `tickets` as the milestone's finished tickets, then follows GitHub. */
  async function following(tickets: Ticket[], options?: { cadenceDays?: string }): Promise<void> {
    fixture.reads[checkout.query] = { tickets: [...OPEN, ...tickets], incomplete: false }
    await enterAndPick(options)
    submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  }

  test('it counts the 8 most recent whole periods, quiet ones 0, leaving out older ones and the current one', async () => {
    // 5-day sprints from 31 Aug: the read reaches whole from the sprint of 20 Sep; the current one, of 9 Nov, is left out
    const sprints = ['2026-09-30', '2026-10-05', '2026-10-10', '2026-10-15', '2026-10-20', '2026-10-25', '2026-10-30', '2026-11-04']
    const counts = [2, 3, 1, 0, 4, 2, 5, 3]
    await following(
      [
        ...finishedOn('older', '2026-09-21', 9),
        ...finishedOn('older', '2026-09-26', 9),
        ...counts.flatMap((count, sprint) => finishedOn('s', sprints[sprint]!, count)),
        ...finishedOn('current', '2026-11-10', 7),
      ],
      { cadenceDays: '5' },
    )

    expect(inputs().milestone.paceSource?.reading).toMatchObject({ window: { counts, starts: sprints }, periods: 'last 8 sprints', firstFinished: undefined })
    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', counts } })
  })

  test('quiet weeks before the first finished ticket are left out, and those after it count 0', async () => {
    await following(finishedInWeeks([0, 0, 0, 2, 3, 0, 4]))

    expect(inputs().milestone.paceSource?.reading).toMatchObject({
      window: { counts: [2, 3, 0, 4], starts: WEEKS.slice(3) },
      periods: '4 weeks',
      firstFinished: 'From the first finished ticket, 12 Oct.',
    })
    expect(forecast()).toMatchObject({
      kind: 'forecast',
      pace: { source: 'tracker', counts: [2, 3, 0, 4] },
      warnings: expect.arrayContaining([{ input: 'pace', message: 'GitHub’s pace: 4 weeks. The forecast needs 8 to be reliable.' }]),
    })
    expect(inputs().milestone.notes).toContainEqual({ input: 'pace', message: '4 of 8 needed for reliable results' })
  })

  test('fewer than 4 weeks stop the forecast, as typed counts do', async () => {
    await following(finishedInWeeks([0, 0, 0, 0, 2, 0, 3]))

    expect(forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'pace', message: 'GitHub’s pace: 3 weeks. The forecast needs at least 4. Type counts, or switch pace to the range.' }],
    })
  })

  test('with nothing finished in the weeks read, there is no pace to follow', async () => {
    await following([])

    expect(inputs().milestone.paceSource?.reading).toMatchObject({ window: { counts: [], starts: [] } })
    expect(forecast()).toMatchObject({ kind: 'problems', problems: [{ input: 'pace', message: expect.stringContaining('GitHub has no finished tickets in the weeks it read') }] })
  })

  test('the pace pattern reads GitHub’s counts as it reads typed counts', async () => {
    await following(finishedInWeeks([5, 6, 4, 7, 5, 6, 8]))

    const view = forecast()
    expect(view.kind === 'forecast' && view.pacePattern?.pattern).toBe('steady')
  })
})

describe('switching pace', () => {
  beforeEach(async () => {
    await connectGitHub()
    await enterAndPick()
    submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  })

  test('switching to the range and back keeps the typed counts', () => {
    submit({ kind: 'setPaceMode', paceMode: 'range' })
    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'range', low: 4, high: 8 } })

    submit({ kind: 'setPaceMode', paceMode: 'counts' })
    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'counts', counts: [1, 2, 3, 4] } })

    submit({ kind: 'setPaceMode', paceMode: 'tracker' })
    expect(inputs().milestone).toMatchObject({ paceMode: 'tracker', paceCounts: [1, 2, 3, 4] })
  })

  test('typing into the opened weeks switches pace to the typed counts, as typed from GitHub’s', () => {
    expect(submit({ kind: 'setPaceCounts', counts: '5, 6, 4, 7, 5, 6, 9' })).toEqual({ saved: true, next: 'inputs' })

    expect(inputs().milestone).toMatchObject({ paceMode: 'counts', paceCounts: [5, 6, 4, 7, 5, 6, 9] })
    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'counts', counts: [5, 6, 4, 7, 5, 6, 9] } })
  })

  test('with no connection, pace falls back to the typed counts, and GitHub is not offered', () => {
    expect(forecast(OFFLINE)).toMatchObject({ kind: 'forecast', pace: { source: 'counts', counts: [1, 2, 3, 4] } })
    expect(inputs(OFFLINE).milestone.paceSource).toBeUndefined()

    submit({ kind: 'setPaceMode', paceMode: 'range' })
    expect(submit({ kind: 'setPaceMode', paceMode: 'tracker' }, OFFLINE)).toMatchObject({ saved: false, view: { refusal: { error: 'Choose the range or typed counts.' } } })
  })
})
