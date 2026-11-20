import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { finishedOn, open } from '../trackerScenario.js'
import { CHECKOUT, pick, TEAM, type ForecastingForTest, submitInputs } from './forecastingForTest.js'
import { READ_AT, Q3_POLISH, anyCounted, atCheck, connect, inputs, setup, setupAt, team } from './setupScenario.js'

// Seam B: the setup summary's Read again, and a read that fails (#217). Arranged through setupScenario.ts. Read
// again's outcome is the Inputs screen whatever it read, so each test asserts what it read through the summary.

/** The note beneath a row whose picks' counts wait for Check (lib/setupSummary.ts's COUNTS_WAIT), written out so the test checks the words, not the constant. */
const COUNTS_WAIT = 'Read again reads each query whole, so the picks show no counts. Change, then Check, counts each pick again.'
const LATER = '2026-11-12T14:30:00Z'

let current: ForecastingForTest
/** Read again, as at LATER. */
function readAgain() {
  current.at(LATER)
  return current.submit({ form: 'readAgain' })
}
const summary = () => setupAt(current)
const forecast = () => current.milestoneForecastView()

describe('Read again', () => {
  /** Connected, the milestone entered with 30 tickets typed and picked (3 open), comparable work picked, and "Use these". */
  async function setUp(): Promise<ForecastingForTest> {
    current = await team()
    const { fixture } = current
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-10', 2), incomplete: false }
    await connect(current)
    await submitInputs(current, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-02', ticketsRemaining: '30' })
    await submitInputs(current, { kind: 'setPaceRange', low: '4', high: '8' })
    await pick(current, READ_AT)
    await pick(current, READ_AT, Q3_POLISH, 'comparableWork')
    await setup(current, { kind: 'useThese' })
    return current
  }

  test('reads the milestone query and comparable work’s, and the summary’s read time updates', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-11', 4), incomplete: false }

    await readAgain()
    expect(await summary()).toMatchObject({ kind: 'summary', readOn: '12 Nov 14:30', flags: [] })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: LATER, tickets: { length: 4 } })
  })

  test('updates a value following the tracker, and leaves a typed one as typed', async () => {
    const { fixture } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }

    await readAgain()
    expect((await inputs(current)).milestone.ticketsSource).toMatchObject({ source: 'typed', reading: { count: 5, readOn: '12 Nov 14:30' } })
    expect(await forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })

    await submitInputs(current, { kind: 'setTicketsSource', ticketsSource: 'tracker' })
    fixture.reads[CHECKOUT.query] = { tickets: open(7), incomplete: false }
    await readAgain()
    expect(await forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
  })

  test('reads the queries alone, not each of several picks: their counts show none until Check reads them again, noted once beneath the rows', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    await setup(current, { kind: 'change' })
    await pick(current, READ_AT, BUG)
    await atCheck(current)
    await setup(current, { kind: 'useThese' })
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(4, 'b')], incomplete: false }
    current.calls.since.length = 0

    await readAgain()
    expect(current.calls.since).toHaveLength(2)
    const view = await summary()
    expect(view).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: 'bug' }] }, countsWait: COUNTS_WAIT })
    expect(view).not.toHaveProperty('milestone.note')
    expect(anyCounted(view)).toBe(false)
  })

  test('leaves no note on a row whose picks’ counts are as Check read them, or of one pick', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    await readAgain()
    expect(await summary()).not.toHaveProperty('countsWait')

    await setup(current, { kind: 'change' })
    await pick(current, READ_AT, BUG)
    await atCheck(current, LATER)
    await setup(current, { kind: 'useThese' })
    expect(await summary()).toMatchObject({ milestone: { picks: [{ count: 3 }, { count: 2 }] } })
    expect(await summary()).not.toHaveProperty('countsWait')
  })

  test('reads nothing while setup is open again with Change', async () => {
    await setUp()
    await setup(current, { kind: 'change' })
    current.calls.since.length = 0

    await readAgain()
    expect(current.calls.since).toEqual([])
  })

  test('reads nothing until setup is done', async () => {
    current = await team()
    await connect(current)
    await pick(current, READ_AT)
    current.calls.since.length = 0

    await readAgain()
    expect(current.calls.since).toEqual([])
  })
})

describe('a failed read', () => {
  async function setUp(): Promise<ForecastingForTest> {
    current = await team()
    const { fixture } = current
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-10', 2), incomplete: false }
    await connect(current)
    await pick(current, READ_AT)
    await pick(current, READ_AT, Q3_POLISH, 'comparableWork')
    await setup(current, { kind: 'useThese' })
    return current
  }

  test('of a tracker unreachable or rate-limited keeps the saved read in use, and the summary says why, until a read is made', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    await readAgain()
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })).toMatchObject({ readAt: READ_AT, tickets: { length: 3 } })
    expect(await summary()).toMatchObject({
      kind: 'summary',
      readOn: '12 Nov 09:05',
      flags: [{ flag: 'GitHub can’t be reached just now, or is limiting requests, so the last read stays in use. Try again in a few minutes.' }],
    })

    fixture.reads[CHECKOUT.query] = { tickets: open(2), incomplete: false }
    await readAgain()
    expect(await summary()).toMatchObject({ readOn: '12 Nov 14:30', flags: [] })
  })

  test('of a token refused says so, and offers Change, which opens the Connect step', async () => {
    const { fixture } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unauthorised' }

    await readAgain()
    expect(await summary()).toMatchObject({
      flags: [
        {
          flag: 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
          change: 'connect',
        },
      ],
    })
    expect(await setup(current, { kind: 'change' })).toMatchObject({ kind: 'saved' })
    expect(await setupAt(current, 'connect')).toMatchObject({ kind: 'steps', step: 'connect' })
  })

  test('with this computer’s keychain failing reads nothing, and the summary says why', async () => {
    await setUp()
    current.calls.since.length = 0
    current.fails.token = true

    await readAgain()
    expect(await summary()).toMatchObject({ flags: [{ flag: expect.stringContaining('keychain couldn’t be used') }] })
    expect(current.calls.since).toEqual([])
  })

  test('of a query the tracker now rejects, or that reaches outside the repo, flags that query, keeping its saved read', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { failure: 'invalidQuery', message: 'The milestone Q3 polish doesn’t exist.' }

    await readAgain()
    expect(await summary()).toMatchObject({
      readOn: '12 Nov 14:30',
      flags: [{ of: 'comparableWork', flag: 'GitHub rejected this query: The milestone Q3 polish doesn’t exist.' }],
    })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: READ_AT })

    fixture.reads[CHECKOUT.query] = { failure: 'outOfScope' }
    await readAgain()
    expect(await summary()).toMatchObject({ flags: [{ of: 'milestoneQuery', flag: expect.stringContaining('outside') }, { of: 'comparableWork' }] })
  })
})
