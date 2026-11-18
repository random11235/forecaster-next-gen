import { describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { setupView, submitSetup } from '../../src/forecast/setup.js'
import { submitStepQuery } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, finishedOn, open, TEAM, type TrackerScenario } from '../trackerScenario.js'
import { READ_AT, Q3_POLISH, scenario, team, settingUp, atCheck } from './setupScenario.js'

// Seam B: the setup summary's count for each pick, and its flags (#217). Arranged through setupScenario.ts.

describe('each pick’s count on the summary', () => {
  const SEARCH: Choice = { kind: 'epic', name: '#57 Search revamp', query: 'parent-issue:shop-team/shop#57' }
  const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
  const FINISHED = finishedOn('f', '2026-11-10', 2)

  /**
   * Connected, each of `choices` picked a minute after the one before, from 08:00, with its own `tickets`: so the
   * milestone query, their OR, is read with all of theirs, and a pick read on its own as the query once was is older.
   */
  async function picked(choices: [Choice, Ticket[]][], to: 'github' | 'jira' = 'github'): Promise<TrackerScenario> {
    const { connect, pick, fixture } = team()
    for (const [choice, tickets] of choices) fixture.reads[choice.query] = { tickets, incomplete: false }
    await connect(to)
    for (let at = 0; at < choices.length; at++) {
      const sofar = choices.slice(0, at + 1)
      fixture.reads[sofar.map(([choice]) => choice.query).join(' OR ')] = { tickets: sofar.flatMap(([, tickets]) => tickets), incomplete: false }
      await pick(`2026-11-12T08:0${at}:00Z`, choices[at]![0])
    }
    return scenario!
  }
  const summary = async () => (await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' }), setupView(settingUp(scenario!), TEAM))

  test('come from the milestone query’s own read for a single pick, open and finished alike, with no extra read', async () => {
    await picked([[CHECKOUT, [...open(3), ...FINISHED]]])
    scenario!.asked.length = 0
    await atCheck()

    expect(scenario!.asked).toEqual([])
    expect(await summary()).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2', kind: 'milestone', count: 5 }] } })
  })

  test('come, for several picks, from a read of each pick at Check: epics, labels and milestones', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, [...open(1, 's'), ...FINISHED]],
      [BUG, open(4, 'b')],
    ])
    const before = await summary()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await atCheck()

    expect(before).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: '#57 Search revamp' }, { name: 'bug' }] } })
    expect(before.kind === 'summary' && 'picks' in before.milestone && before.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
    expect(await summary()).toMatchObject({
      milestone: {
        picks: [
          { name: 'Checkout v2', kind: 'milestone', count: 3 },
          { name: '#57 Search revamp', kind: 'epic', count: 3 },
          { name: 'bug', kind: 'label', count: 4 },
        ],
      },
    })
  })

  test('are held in setup’s draft with the rest until "Use these": Cancel leaves the summary without them', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, open(1, 's')],
    ])
    await summary()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await atCheck()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })

    const view = setupView(settingUp(scenario!), TEAM)
    expect(view.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
  })

  test('come for Jira’s fix versions too', async () => {
    const VERSION: Choice = { kind: 'fixVersion', name: '2.4', query: 'fixVersion = "2.4"' }
    const EPIC: Choice = { kind: 'epic', name: 'SHOP-41 Checkout v2', query: 'parent = SHOP-41' }
    await picked(
      [
        [VERSION, open(2, 'v')],
        [EPIC, open(6, 'e')],
      ],
      'jira',
    )
    await atCheck()

    expect(await summary()).toMatchObject({
      milestone: {
        picks: [
          { name: '2.4', kind: 'fix version', count: 2 },
          { name: 'SHOP-41 Checkout v2', kind: 'epic', count: 6 },
        ],
      },
    })
  })

  test('are read once at Check: a pick read since its query was is not read again, as comparable work’s picks are when picked', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, open(1, 's')],
    ])
    scenario!.fixture.reads[BUG.query] = { tickets: FINISHED, incomplete: false }
    scenario!.fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-09', 1), incomplete: false }
    await scenario!.pick(READ_AT, BUG, COMPARABLE_WORK)
    await scenario!.pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    scenario!.asked.length = 0
    await atCheck()
    const reads = scenario!.asked.length
    await atCheck()

    expect(reads).toBe(2)
    expect(scenario!.asked.length).toBe(reads)
    expect(await summary()).toMatchObject({
      comparable: {
        picks: [
          { name: 'bug', count: 2 },
          { name: 'Q3 polish', count: 1 },
        ],
      },
    })
  })

  test('are not read as the Inputs screen opens, and a pick whose read failed or is incomplete has none', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, open(1, 's')],
    ])
    scenario!.fixture.reads[CHECKOUT.query] = { tickets: open(9, 'c'), incomplete: true }
    scenario!.fixture.reads[SEARCH.query] = { failure: 'unavailable' }
    scenario!.asked.length = 0
    await summary()
    scenario!.inputs()

    expect(scenario!.asked).toEqual([])
    await atCheck()
    const view = await summary()
    expect(view).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: '#57 Search revamp' }] } })
    expect(view.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
  })

  test('flag a pick whose own read failed at Check, until a later Check reads it', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, open(1, 's')],
    ])
    scenario!.fixture.reads[SEARCH.query] = { failure: 'unavailable' }
    await atCheck()

    expect(await summary()).toMatchObject({
      milestone: { picks: [{ name: 'Checkout v2', count: 3 }, { name: '#57 Search revamp' }] },
      flags: [{ of: 'milestoneQuery', flag: '#57 Search revamp couldn’t be read on its own, so it shows no count. Change, then Check, reads it again.' }],
    })

    scenario!.fixture.reads[SEARCH.query] = { tickets: open(1, 's'), incomplete: false }
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await atCheck()
    expect(await summary()).toMatchObject({ milestone: { picks: [{ count: 3 }, { count: 1 }] }, flags: [] })
  })

  test('hold a pick’s failed read at Check in setup’s draft: Cancel leaves the summary without its flag', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, open(1, 's')],
    ])
    await summary()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    scenario!.fixture.reads[SEARCH.query] = { failure: 'unavailable' }
    await atCheck()

    expect(scenario!.storage.readFailures(TEAM)).toBeUndefined()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ flags: [] })
  })

  test('flag a pick whose read failed on its own row only, though its query is comparable work’s too', async () => {
    const { connect, pick, fixture } = team()
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-09', 1), incomplete: false }
    fixture.reads[CHECKOUT.query] = { tickets: open(3, 'c'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${Q3_POLISH.query}`] = { tickets: open(3, 'c'), incomplete: false }
    await connect()
    await pick('2026-11-12T07:00:00Z', Q3_POLISH, COMPARABLE_WORK)
    await pick('2026-11-12T08:00:00Z', CHECKOUT)
    await pick('2026-11-12T08:01:00Z', Q3_POLISH)
    fixture.reads[Q3_POLISH.query] = { failure: 'unavailable' }
    await atCheck()

    expect(await summary()).toMatchObject({
      flags: [{ of: 'milestoneQuery', flag: 'Q3 polish couldn’t be read on its own, so it shows no count. Change, then Check, reads it again.' }],
    })
  })

  test('are none for a query written by hand', async () => {
    await picked([[CHECKOUT, open(3, 'c')]])
    const written = 'milestone:"Checkout v2" -label:wontfix'
    scenario!.fixture.reads[written] = { tickets: open(3), incomplete: false }
    await submitStepQuery(scenario!.using, TEAM, { kind: 'editQuery', query: written }, READ_AT)
    scenario!.asked.length = 0
    await atCheck()

    expect(scenario!.asked).toEqual([])
    expect(await summary()).toMatchObject({ milestone: { query: written } })
  })
})

describe('the summary’s flags', () => {
  /** Connected, the milestone picked and read as `milestone`, comparable work picked as Q3 polish when read as `comparable`, and "Use these". */
  async function summaryWith(milestone: { tickets: Ticket[]; incomplete: boolean }, comparable?: { tickets: Ticket[]; incomplete: boolean }) {
    const { connect, pick, fixture } = team()
    fixture.reads[CHECKOUT.query] = milestone
    await connect()
    await pick(READ_AT)
    if (comparable) {
      fixture.reads[Q3_POLISH.query] = comparable
      await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    }
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    return setupView(settingUp(scenario!), TEAM)
  }
  const FINISHED = finishedOn('f', '2026-11-10', 2)

  test('are none for a working setup', async () => {
    expect(await summaryWith({ tickets: [...open(3), ...FINISHED], incomplete: false }, { tickets: FINISHED, incomplete: false })).toMatchObject({ flags: [] })
  })

  test('say when the milestone query matches nothing', async () => {
    expect(await summaryWith({ tickets: [], incomplete: false })).toMatchObject({
      flags: [
        {
          of: 'milestoneQuery',
          flag: 'This query matches nothing: no open tickets, and none finished in the last 9 weeks. Check it picks out the milestone’s tickets.',
        },
      ],
    })
  })

  test('say when a read is incomplete, the milestone’s or comparable work’s', async () => {
    const view = await summaryWith({ tickets: open(3), incomplete: true }, { tickets: FINISHED, incomplete: true })
    const flag = 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.'
    expect(view).toMatchObject({
      flags: [
        { of: 'milestoneQuery', flag },
        { of: 'comparableWork', flag },
      ],
    })
  })

  test('are only the query flags, an incomplete read and a failed read: none for comparable work finishing nothing', async () => {
    expect(await summaryWith({ tickets: open(3), incomplete: false }, { tickets: open(2, 'c'), incomplete: false })).toMatchObject({ flags: [] })
  })
})
