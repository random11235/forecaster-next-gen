import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { cannedConnector, type CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { submitConnection } from '../../src/forecast/connection.js'
import { finishedSinceFor, readQuery } from '../../src/forecast/finished.js'
import { inputsView, submitInputs, type InputsEdit } from '../../src/forecast/inputs.js'
import { submitStepQuery, type StepReading } from '../../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { TrackerReads } from '../../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../../src/secrets/memorySecrets.js'
import { openSqliteStorage, type SqliteStorage } from '../../src/storage/sqliteStorage.js'

// The faint previous value (#214): a value following the tracker shows, faintly, the value the latest read replaced.

const TEAM = 'team'
// Thursday
const TODAY = '2026-11-12'
// a week before: the read then counted the weeks up to w/c 26 Oct
const FIRST_READ_AT = '2026-11-05T09:05:00Z'
const READ_AT = '2026-11-12T09:12:00Z'
// a Monday, long before the reads reach, so the milestone's own pace counts every week they reach whole
const START = '2026-08-31'

// Mondays of the weeks the reads reach, from 14 Sep
const WEEKS = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02']

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

const open = (count: number): Ticket[] => Array.from({ length: count }, (_, i) => ({ id: `o${i}` }))

/** Tickets finished `counts[i]` on the Tuesday of `WEEKS[i]`. */
const finishedInWeeks = (counts: number[]): Ticket[] =>
  counts.flatMap((count, week) => Array.from({ length: count }, (_, i) => ({ id: `w${week}-${i}`, finishedAt: `${tuesdayOf(WEEKS[week]!)}T10:00:00Z` })))

const tuesdayOf = (monday: string): string => new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

let fixture: CannedFixture
let dir: string
let storage: SqliteStorage
let using: StepReading
let tracker: TrackerReads

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'forecaster-previous-value-'))
  storage = openSqliteStorage(join(dir, 'forecaster.db'))
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  fixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [checkout], pastLimit: false }],
    reads: { [checkout.query]: { tickets: [...open(34), ...finishedInWeeks([5, 6, 8, 5, 7, 6, 4, 0])], incomplete: false } },
  }
  using = {
    connections: storage,
    reads: storage,
    milestoneQueries: storage,
    milestoneInputs: storage,
    secrets: openMemorySecrets(),
    // the fixture as it is when read, so a test can change what the next read finds
    connector: () => cannedConnector(fixture),
  }
  tracker = { ...using, timeZone: 'UTC' }
  await submitConnection(using, TEAM, { kind: 'connect', tracker: 'github', repo: 'shop-team/shop', site: '', projectKey: '', email: '', token: 'token' })
  submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: START, ticketsRemaining: '30' })
  submit({ kind: 'setPaceRange', low: '4', high: '8' })
  // the first read, a week ago
  await submitStepQuery(using, TEAM, { kind: 'addPick', choice: checkout }, FIRST_READ_AT)
  submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
  submit({ kind: 'setPaceMode', paceMode: 'tracker' })
})

afterEach(() => {
  storage.close()
  rmSync(dir, { recursive: true, force: true })
})

const submit = (edit: InputsEdit) => submitInputs(storage, TEAM, DEFAULT_SETTINGS, TODAY, edit, { tracker })

const inputs = () => inputsView(storage, TEAM, DEFAULT_SETTINGS, TODAY, { tracker }).milestone

/** Reads the milestone query again at `readAt`, as a later read of the tracker does. */
async function readAgain(readAt = READ_AT): Promise<void> {
  await readQuery(cannedConnector(fixture), storage, { teamId: TEAM, query: checkout.query, finishedSince: finishedSinceFor(readAt), readAt })
}

describe('a value following the tracker', () => {
  test('after the first read, neither value has a previous one', () => {
    expect(inputs().ticketsSource).toMatchObject({ reading: { count: 34 }, was: undefined })
    expect(inputs().trackerPace).toMatchObject({ reading: { line: 'last 8 weeks · read 5 Nov 09:05' }, was: undefined })
  })

  test('a read updates tickets remaining, with the value it replaced and when that was read', async () => {
    fixture.reads[checkout.query] = { tickets: [...open(31), ...finishedInWeeks([5, 6, 8, 5, 7, 6, 4, 3])], incomplete: false }

    await readAgain()

    expect(inputs().ticketsSource).toMatchObject({ reading: { count: 31, readOn: '12 Nov 09:12' }, was: { count: 34, readOn: '5 Nov 09:05' } })
  })

  test('a read updates pace, with the counts pace showed before it: the window as it was then', async () => {
    fixture.reads[checkout.query] = { tickets: [...open(31), ...finishedInWeeks([5, 6, 8, 5, 7, 6, 4, 3])], incomplete: false }

    await readAgain()

    expect(inputs().trackerPace).toMatchObject({
      reading: { counts: [5, 6, 8, 5, 7, 6, 4, 3], line: 'last 8 weeks · read 12 Nov 09:12' },
      // read on 5 Nov, pace counted the weeks it reached whole, up to w/c 26 Oct
      was: { counts: [5, 6, 8, 5, 7, 6, 4], readOn: '5 Nov 09:05' },
    })
  })

  test('a read that changed nothing shows no previous value', async () => {
    await readAgain('2026-11-05T15:00:00Z')

    expect(inputs().ticketsSource).toMatchObject({ reading: { readOn: '5 Nov 15:00' }, was: undefined })
    expect(inputs().trackerPace).toMatchObject({ reading: { line: 'last 8 weeks · read 5 Nov 15:00' }, was: undefined })
  })

  test('a typed value shows none: only a value following the tracker does', async () => {
    fixture.reads[checkout.query] = { tickets: [...open(31), ...finishedInWeeks([5, 6, 8, 5, 7, 6, 4, 3])], incomplete: false }
    await readAgain()

    submit({ kind: 'setTicketsSource', ticketsSource: 'typed' })
    submit({ kind: 'setPaceMode', paceMode: 'range' })

    expect(inputs().ticketsSource).toMatchObject({ source: 'typed', was: undefined })
    expect(inputs().trackerPace).toMatchObject({ was: undefined })
  })
})
