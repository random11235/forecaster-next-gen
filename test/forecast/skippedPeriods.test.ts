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
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import { submitSkip, type Skipping } from '../../src/forecast/skippedPeriods.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// Skipping a tracker period (#213): pace stays on the tracker, its window reaching back past the skipped periods to
// keep up to 8 counted; skips belong to the milestone and outlast reads, and can be counted again.

const TEAM = 'team'
// Thursday; with nothing skipped the read reaches back 9 weeks, to Thursday 10 Sep, so whole from Monday 14 Sep
const TODAY = '2026-11-12'
const READ_AT = '2026-11-12T09:00:00Z'
const NEXT_READ_AT = '2026-11-12T14:30:00Z'
// a Monday, long before the reads reach
const START = '2026-08-10'

// Mondays of the weeks GitHub has finished tickets in: two before the first read reaches, then the 8 it reaches whole
const WEEKS = ['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']
const COUNTS = [4, 6, 3, 5, 6, 4, 7, 5, 6, 8]
// the holiday weeks, 12 and 19 Oct
const HOLIDAYS = ['2026-10-12', '2026-10-19']

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** Tickets finished `counts[i]` in the week of `WEEKS[i]`, on its Tuesday. */
const finishedInWeeks = (counts: number[]): Ticket[] =>
  counts.flatMap((count, week) => Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: `${addDay(WEEKS[week]!)}T10:00:00Z` })))

let fixture: CannedFixture
let dir: string
let storage: SqliteStorage
let using: Skipping
let tracker: TrackerReads
let asked: string[]

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-skipped-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  fixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
    reads: { [checkout.query]: { tickets: [{ id: 'o1' }, ...finishedInWeeks(COUNTS)], incomplete: false } },
  }
  asked = []
  using = {
    connections: storage,
    milestoneInputs: storage,
    reads: storage,
    milestoneQueries: storage,
    secrets: openMemorySecrets(),
    connector: () => {
      const canned = cannedConnector(fixture)
      return { ...canned, read: (query, finishedSince) => (asked.push(finishedSince), canned.read(query, finishedSince)) }
    },
  }
  tracker = { ...using, timeZone: 'UTC' }
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
  submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  submit({ kind: 'setPaceRange', low: '4', high: '8' })
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, READ_AT)
  submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  asked = []
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

const submit = (edit: InputsEdit) => submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit, { tracker })

const reading = () => inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker }).milestone.paceSource?.reading

const forecast = () => milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker })

const skip = (periods: string[], readAt = READ_AT) => submitSkip(using, TEAM, { kind: 'skip', periods }, readAt)

describe('skipping a period', () => {
  test('keeps 8 counted by reaching back past the skipped weeks, reading GitHub further back to do so', async () => {
    await skip(HOLIDAYS)

    // 11 weeks back from Thursday 12 Nov: the 8 counted, the 2 skipped, and the current one
    expect(asked).toEqual(['2026-08-27T09:00:00.000Z'])
    expect(reading()).toMatchObject({
      window: { counts: [4, 6, 3, 5, 6, 4, 6, 8], starts: [...WEEKS.slice(0, 6), ...WEEKS.slice(8)] },
      skipped: { counts: [7, 5], starts: HOLIDAYS },
      periods: 'last 8 weeks',
      skippedLine: '2 skipped (12 Oct, 19 Oct), reaching back to w/c 31 Aug',
    })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ paceMode: 'tracker', paceWindow: { skippedPeriods: HOLIDAYS } })
  })

  test('the forecast’s pace says how many are skipped', async () => {
    await skip(HOLIDAYS)

    expect(forecast()).toMatchObject({ kind: 'forecast', pace: { source: 'tracker', tracker: 'GitHub', counts: [4, 6, 3, 5, 6, 4, 6, 8], skipped: 2 } })
  })

  test('with GitHub holding no earlier weeks, fewer are counted, and the skip line says so', async () => {
    fixture.reads[checkout.query] = { tickets: finishedInWeeks([0, 0, ...COUNTS.slice(2)]), incomplete: false }
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-14', ticketsRemaining: '30' })

    await skip(HOLIDAYS)

    expect(reading()).toMatchObject({
      window: { counts: [3, 5, 6, 4, 6, 8] },
      skippedLine: '2 skipped (12 Oct, 19 Oct), and GitHub has no earlier weeks to count instead',
    })
  })

  test('skips outlast a read: the next one reaches back past them too, and they stay skipped', async () => {
    await skip(HOLIDAYS)
    fixture.reads[checkout.query] = { tickets: [...finishedInWeeks(COUNTS), { id: 'late', finishedAt: '2026-11-06T10:00:00Z' }], incomplete: false }
    asked = []

    await readQuery(cannedConnector(fixture), storage, { teamId: TEAM, query: checkout.query, finishedSince: finishedSinceFor(NEXT_READ_AT, storage.milestoneInputs(TEAM)), readAt: NEXT_READ_AT })

    expect(reading()).toMatchObject({
      window: { counts: [4, 6, 3, 5, 6, 4, 6, 9] },
      skipped: { starts: HOLIDAYS },
      readOn: '12 Nov 14:30',
    })
  })
})

describe('counting skipped periods again', () => {
  test('one counted again counts in the window again, reading nothing', async () => {
    await skip(HOLIDAYS)
    asked = []

    await submitSkip(using, TEAM, { kind: 'countAgain', periods: ['2026-10-19'] }, READ_AT)

    expect(asked).toEqual([])
    expect(reading()).toMatchObject({
      window: { counts: [6, 3, 5, 6, 4, 5, 6, 8] },
      skipped: { counts: [7], starts: ['2026-10-12'] },
      skippedLine: '1 skipped (12 Oct), reaching back to w/c 7 Sep',
    })
  })

  test('all counted again, the window is the last 8 weeks as before, and skipping one already reached reads nothing', async () => {
    await skip(HOLIDAYS)
    await submitSkip(using, TEAM, { kind: 'countAgain', periods: HOLIDAYS }, READ_AT)

    expect(reading()).toMatchObject({ window: { counts: [3, 5, 6, 4, 7, 5, 6, 8] }, skipped: { counts: [] }, skippedLine: undefined })

    asked = []
    await skip(['2026-10-12'])
    expect(asked).toEqual([])
  })
})

describe('every period skipped', () => {
  test('there is no pace, and no forecast: count a week again, or use typed counts or the range', async () => {
    await skip(WEEKS)

    expect(reading()).toMatchObject({ window: { counts: [] }, periods: 'every week skipped', skippedLine: expect.stringMatching(/^10 skipped \(31 Aug, .*, 2 Nov\), so no weeks count$/) })
    expect(forecast()).toMatchObject({
      kind: 'problems',
      problems: [{ input: 'pace', message: 'Every week is skipped, so GitHub gives no pace. Count a week again, or use typed counts or the range.' }],
    })
  })
})
