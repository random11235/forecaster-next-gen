import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { COUNTS_WAIT, setupView, submitSetup } from '../../src/forecast/setup.js'
import { submitReadAgain } from '../../src/forecast/setupReads.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, finishedOn, open, TEAM, type TrackerScenario } from '../trackerScenario.js'
import { READ_AT, Q3_POLISH, scenario, team, settingUp, atCheck } from './setupScenario.js'

// Seam B: the setup summary's Read again, and a read that fails (#217). Arranged through setupScenario.ts.

describe('Read again', () => {
  const LATER = '2026-11-12T14:30:00Z'

  /** Connected, the milestone entered with 30 tickets typed and picked (3 open), comparable work picked, and "Use these". */
  async function setUp(): Promise<TrackerScenario> {
    const { connect, pick, fixture, submit } = team()
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-10', 2), incomplete: false }
    await connect()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-02', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    return scenario()
  }
  const readAgain = () => submitReadAgain(settingUp(scenario()), TEAM, LATER)

  test('reads the milestone query and comparable work’s, and the summary’s read time updates', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-11', 4), incomplete: false }

    expect(await readAgain()).toEqual({ kind: 'read' })
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ kind: 'summary', readOn: '12 Nov 14:30', flags: [] })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: LATER, tickets: { length: 4 } })
  })

  test('updates a value following the tracker, and leaves a typed one as typed', async () => {
    const { fixture, submit } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }

    await readAgain()
    expect(scenario().inputs().milestone.ticketsSource).toMatchObject({ source: 'typed', reading: { count: 5, readOn: '12 Nov 14:30' } })
    expect(scenario().forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    fixture.reads[CHECKOUT.query] = { tickets: open(7), incomplete: false }
    await readAgain()
    expect(scenario().forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
  })

  test('reads the queries alone, not each of several picks: their counts show none until Check reads them again, noted once beneath the rows', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    await scenario().pick(READ_AT, BUG)
    await atCheck()
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(4, 'b')], incomplete: false }
    scenario().asked.length = 0

    await readAgain()
    expect(scenario().asked).toHaveLength(2)
    const view = setupView(settingUp(scenario()), TEAM)
    expect(view).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: 'bug' }] }, countsWait: COUNTS_WAIT })
    expect(view).not.toHaveProperty('milestone.note')
    expect(view.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
  })

  test('leaves no note on a row whose picks’ counts are as Check read them, or of one pick', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    await readAgain()
    expect(setupView(settingUp(scenario()), TEAM)).not.toHaveProperty('countsWait')

    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    await scenario().pick(READ_AT, BUG)
    await atCheck(LATER)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    expect(setupView(settingUp(scenario()), TEAM)).toMatchObject({ milestone: { picks: [{ count: 3 }, { count: 2 }] } })
    expect(setupView(settingUp(scenario()), TEAM)).not.toHaveProperty('countsWait')
  })

  test('reads nothing while setup is open again with Change', async () => {
    await setUp()
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })
    scenario().asked.length = 0

    expect(await readAgain()).toEqual({ kind: 'unchanged' })
    expect(scenario().asked).toEqual([])
  })

  test('reads nothing until setup is done', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    scenario().asked.length = 0

    expect(await readAgain()).toEqual({ kind: 'unchanged' })
    expect(scenario().asked).toEqual([])
  })
})

describe('a failed read', () => {
  const LATER = '2026-11-12T14:30:00Z'

  async function setUp(): Promise<TrackerScenario> {
    const { connect, pick, fixture } = team()
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-10', 2), incomplete: false }
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    await submitSetup(settingUp(scenario()), TEAM, { kind: 'useThese' })
    return scenario()
  }
  const readAgain = () => submitReadAgain(settingUp(scenario()), TEAM, LATER)
  const summary = () => setupView(settingUp(scenario()), TEAM)

  test('of a tracker unreachable or rate-limited keeps the saved read in use, and the summary says why, until a read is made', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    expect(await readAgain()).toEqual({ kind: 'failed' })
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })).toMatchObject({ readAt: READ_AT, tickets: { length: 3 } })
    expect(summary()).toMatchObject({
      kind: 'summary',
      readOn: '12 Nov 09:05',
      flags: [{ flag: 'GitHub can’t be reached just now, or is limiting requests, so the last read stays in use. Try again in a few minutes.' }],
    })

    fixture.reads[CHECKOUT.query] = { tickets: open(2), incomplete: false }
    expect(await readAgain()).toEqual({ kind: 'read' })
    expect(summary()).toMatchObject({ readOn: '12 Nov 14:30', flags: [] })
  })

  test('of a token refused says so, and offers Change, which opens the Connect step', async () => {
    const { fixture } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unauthorised' }

    expect(await readAgain()).toEqual({ kind: 'failed' })
    expect(summary()).toMatchObject({
      flags: [
        {
          flag: 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
          change: 'connect',
        },
      ],
    })
    expect(await submitSetup(settingUp(scenario()), TEAM, { kind: 'change' })).toMatchObject({ saved: true })
    expect(setupView(settingUp(scenario()), TEAM, 'connect')).toMatchObject({ kind: 'steps', step: 'connect' })
  })

  test('with this computer’s keychain failing reads nothing, and the summary says why', async () => {
    await setUp()
    scenario().asked.length = 0
    const keychainFailing = { ...scenario().using, secrets: { ...scenario().using.secrets, token: () => Promise.reject(new Error('locked')) } }

    expect(await submitReadAgain(keychainFailing, TEAM, LATER)).toEqual({ kind: 'failed' })
    expect(summary()).toMatchObject({ flags: [{ flag: expect.stringContaining('keychain couldn’t be used') }] })
    expect(scenario().asked).toEqual([])
  })

  test('of a query the tracker now rejects, or that reaches outside the repo, flags that query, keeping its saved read', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { failure: 'invalidQuery', message: 'The milestone Q3 polish doesn’t exist.' }

    expect(await readAgain()).toEqual({ kind: 'failed' })
    expect(summary()).toMatchObject({
      readOn: '12 Nov 14:30',
      flags: [{ of: 'comparableWork', flag: 'GitHub rejected this query: The milestone Q3 polish doesn’t exist.' }],
    })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: READ_AT })

    fixture.reads[CHECKOUT.query] = { failure: 'outOfScope' }
    await readAgain()
    expect(summary()).toMatchObject({ flags: [{ of: 'milestoneQuery', flag: expect.stringContaining('outside') }, { of: 'comparableWork' }] })
  })
})
