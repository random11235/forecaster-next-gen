import { afterEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { readPicks, setupView, submitReadAgain, submitSetup, throughDraft, type SettingUp } from '../../src/forecast/setup.js'
import { queryStepView, submitStepQuery, type StepQueryEdit } from '../../src/forecast/queryStep.js'
import { COMPARABLE_WORK, MILESTONE_QUERY, type StepQuery } from '../../src/forecast/stepQuery.js'
import { CHECKOUT, finishedOn, open, TEAM, TODAY, trackerScenario, type TrackerScenario } from '../trackerScenario.js'

// Seam B: the Inputs screen's setup steps (#217), Connect → Milestone → Comparable work → Check, one at a time, closing
// with "Use these" to a summary of the connection, or skipped to the inputs typed.

const READ_AT = '2026-11-12T09:05:00Z'
const Q3_POLISH: Choice = { kind: 'milestone', name: 'Q3 polish', query: 'milestone:"Q3 polish"' }

let scenario: TrackerScenario | undefined

afterEach(() => {
  scenario?.close()
  scenario = undefined
})

/** A team not yet connected, with Q3 polish to pick as comparable work. */
function team(): TrackerScenario {
  scenario = trackerScenario()
  scenario.fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH], pastLimit: false }]
  scenario.fixture.reads[Q3_POLISH.query] = { tickets: [], incomplete: false }
  return scenario
}

const settingUp = ({ using }: TrackerScenario): SettingUp => ({ ...using, timeZone: 'UTC' })

describe('the setup steps', () => {
  test('open at Connect, the first of four, with nothing to go back or on to, until the team connects', () => {
    const view = setupView(settingUp(team()), TEAM, 'check')

    expect(view).toEqual({
      kind: 'steps',
      step: 'connect',
      steps: [
        { step: 'connect', mark: 'current' },
        { step: 'milestone', mark: 'ahead' },
        { step: 'comparableWork', mark: 'ahead' },
        { step: 'check', mark: 'ahead' },
      ],
    })
  })

  test('once connected, open at Milestone, back to Connect, and on to Comparable work only once the milestone has a query', async () => {
    const { connect, pick } = team()
    await connect()
    const before = setupView(settingUp(scenario!), TEAM)
    await pick(READ_AT)

    expect(before).toMatchObject({ step: 'milestone', back: 'connect' })
    expect(before).not.toHaveProperty('next')
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({
      step: 'milestone',
      steps: [
        { step: 'connect', mark: 'done' },
        { step: 'milestone', mark: 'current' },
        { step: 'comparableWork', mark: 'ahead' },
        { step: 'check', mark: 'ahead' },
      ],
      back: 'connect',
      next: { step: 'comparableWork', label: 'next' },
    })
  })

  test('walk forward to Check and back, Comparable work skipped until it has a query, then Next', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    const at = (step: string) => setupView(settingUp(scenario!), TEAM, step)

    expect(at('connect')).toMatchObject({ step: 'connect', next: { step: 'milestone', label: 'next' } })
    expect(at('connect')).not.toHaveProperty('back')
    expect(at('comparableWork')).toMatchObject({ step: 'comparableWork', back: 'milestone', next: { step: 'check', label: 'skip' } })
    expect(at('check')).toMatchObject({
      step: 'check',
      steps: [
        { step: 'connect', mark: 'done' },
        { step: 'milestone', mark: 'done' },
        { step: 'comparableWork', mark: 'done' },
        { step: 'check', mark: 'current' },
      ],
      back: 'comparableWork',
    })
    expect(at('check')).not.toHaveProperty('next')

    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    expect(at('comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
  })

  test('read Skip again once comparable work is started afresh, and stay at Milestone once its last pick is removed', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    const at = (step: string) => setupView(settingUp(scenario!), TEAM, step)

    await submitStepQuery(scenario!.using, TEAM, { kind: 'startAfresh' }, READ_AT, COMPARABLE_WORK)
    expect(at('comparableWork')).toMatchObject({ next: { step: 'check', label: 'skip' } })

    await submitStepQuery(scenario!.using, TEAM, { kind: 'removePick', query: CHECKOUT.query }, READ_AT)
    expect(at('check')).toMatchObject({ step: 'milestone' })
    expect(at('milestone')).not.toHaveProperty('next')
  })

  test('stay at Milestone, asked for a later step, until the milestone has a query', async () => {
    const { connect } = team()
    await connect()

    expect(setupView(settingUp(scenario!), TEAM, 'check')).toMatchObject({ step: 'milestone' })
    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).toMatchObject({ step: 'milestone' })
    expect(setupView(settingUp(scenario!), TEAM, 'nonsense')).toMatchObject({ step: 'milestone' })
  })

  test('are not in the browser build, which has nothing to connect with', () => {
    expect(setupView(undefined, TEAM)).toEqual({ kind: 'noSetup' })
  })
})

describe('"Use these"', () => {
  test('closes setup to a summary naming the tracker, the repo and when the milestone was read, in the EM’s time zone', async () => {
    const { connect, pick, fixture } = team()
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    await connect()
    await pick(READ_AT)

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: true })
    expect(setupView({ ...settingUp(scenario!), timeZone: 'Australia/Sydney' }, TEAM)).toEqual({
      kind: 'summary',
      tracker: 'GitHub',
      where: 'shop-team/shop',
      readOn: '12 Nov 20:05',
      milestone: { picks: [{ name: 'Checkout v2', kind: 'milestone', count: 3 }] },
      note: 'Leaf tickets only. Epics include their sub-epics.',
      flags: [],
    })
  })

  test('names a Jira project', async () => {
    const { connect, pick } = team()
    await connect('jira')
    await pick(READ_AT)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', tracker: 'Jira', where: 'shop.atlassian.net · SHOP' })
  })

  test('is refused, and setup stays open, until the team is connected and the milestone has a query', async () => {
    const { connect } = team()
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: false })
    await connect()
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: false })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })
  })
})

describe('the summary’s rows', () => {
  const SEARCH: Choice = { kind: 'epic', name: '#57 Search revamp', query: 'parent-issue:shop-team/shop#57' }
  const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }

  /** Connected, with the milestone picked (as `choices`, all read with `tickets`), and setup closed with "Use these". */
  async function setUp(choices: Choice[] = [CHECKOUT]): Promise<TrackerScenario> {
    const { connect, pick, fixture } = team()
    fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH, SEARCH, BUG], pastLimit: false }]
    for (const choice of [SEARCH, BUG]) fixture.reads[choice.query] = { tickets: [{ id: choice.name, finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await connect()
    for (const choice of choices) await pick(READ_AT, choice)
    return scenario!
  }
  const summary = () => (submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' }), setupView(settingUp(scenario!), TEAM))

  test('name the milestone’s and comparable work’s picks, in the order picked, each with its kind', async () => {
    const { fixture } = await setUp([CHECKOUT, SEARCH])
    fixture.reads[Q3_POLISH.query] = { tickets: [{ id: 'q', finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await scenario!.pick(READ_AT, BUG, COMPARABLE_WORK)
    await scenario!.pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)

    expect(summary()).toMatchObject({
      milestone: { picks: [{ name: 'Checkout v2', kind: 'milestone' }, { name: '#57 Search revamp', kind: 'epic' }] },
      comparable: { picks: [{ name: 'bug', kind: 'label' }, { name: 'Q3 polish', kind: 'milestone' }] },
    })
  })

  test('show a query written by hand as written, and no Comparable row without comparable work', async () => {
    const { fixture } = await setUp()
    const written = 'milestone:"Checkout v2" -label:wontfix'
    fixture.reads[written] = { tickets: open(3), incomplete: false }
    await submitStepQuery(scenario!.using, TEAM, { kind: 'editQuery', query: written }, READ_AT)

    const view = summary()
    expect(view).toMatchObject({ milestone: { query: written } })
    expect(view).not.toHaveProperty('comparable')
  })

  test('name Jira’s picks in Jira’s kinds', async () => {
    const VERSION: Choice = { kind: 'fixVersion', name: '2.4', query: 'fixVersion = "2.4"' }
    const EPIC: Choice = { kind: 'epic', name: 'SHOP-41 Checkout v2', query: 'parent = SHOP-41' }
    const LABEL: Choice = { kind: 'label', name: 'checkout', query: 'labels = checkout' }
    const { fixture } = team()
    for (const choice of [VERSION, EPIC, LABEL]) fixture.reads[choice.query] = { tickets: open(1, choice.name), incomplete: false }
    await scenario!.connect('jira')
    for (const choice of [VERSION, EPIC, LABEL]) await scenario!.pick(READ_AT, choice)

    expect(summary()).toMatchObject({
      milestone: { picks: [{ name: '2.4', kind: 'fix version' }, { name: 'SHOP-41 Checkout v2', kind: 'epic' }, { name: 'checkout', kind: 'label' }] },
    })
  })
})

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
  const summary = () => (submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' }), setupView(settingUp(scenario!), TEAM))

  test('come from the milestone query’s own read for a single pick, open and finished alike, with no extra read', async () => {
    await picked([[CHECKOUT, [...open(3), ...FINISHED]]])
    scenario!.asked.length = 0
    await readPicks(scenario!.using, TEAM, READ_AT)

    expect(scenario!.asked).toEqual([])
    expect(summary()).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2', kind: 'milestone', count: 5 }] } })
  })

  test('come, for several picks, from a read of each pick at Check: epics, labels and milestones', async () => {
    await picked([
      [CHECKOUT, open(3, 'c')],
      [SEARCH, [...open(1, 's'), ...FINISHED]],
      [BUG, open(4, 'b')],
    ])
    const before = summary()
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await readPicks(scenario!.using, TEAM, READ_AT)

    expect(before).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: '#57 Search revamp' }, { name: 'bug' }] } })
    expect(before.kind === 'summary' && 'picks' in before.milestone && before.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
    expect(summary()).toMatchObject({
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
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
    summary()
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await readPicks(scenario!.using, TEAM, READ_AT)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })

    const view = setupView(settingUp(scenario!), TEAM)
    expect(view.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
  })

  test('come for Jira’s fix versions too', async () => {
    const VERSION: Choice = { kind: 'fixVersion', name: '2.4', query: 'fixVersion = "2.4"' }
    const EPIC: Choice = { kind: 'epic', name: 'SHOP-41 Checkout v2', query: 'parent = SHOP-41' }
    await picked([[VERSION, open(2, 'v')], [EPIC, open(6, 'e')]], 'jira')
    await readPicks(scenario!.using, TEAM, READ_AT)

    expect(summary()).toMatchObject({ milestone: { picks: [{ name: '2.4', kind: 'fix version', count: 2 }, { name: 'SHOP-41 Checkout v2', kind: 'epic', count: 6 }] } })
  })

  test('are read once at Check: a pick read since its query was is not read again, as comparable work’s picks are when picked', async () => {
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
    scenario!.fixture.reads[BUG.query] = { tickets: FINISHED, incomplete: false }
    scenario!.fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-09', 1), incomplete: false }
    await scenario!.pick(READ_AT, BUG, COMPARABLE_WORK)
    await scenario!.pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    scenario!.asked.length = 0
    await readPicks(scenario!.using, TEAM, READ_AT)
    const atCheck = scenario!.asked.length
    await readPicks(scenario!.using, TEAM, READ_AT)

    expect(atCheck).toBe(2)
    expect(scenario!.asked.length).toBe(atCheck)
    expect(summary()).toMatchObject({ comparable: { picks: [{ name: 'bug', count: 2 }, { name: 'Q3 polish', count: 1 }] } })
  })

  test('are not read as the Inputs screen opens, and a pick whose read failed or is incomplete has none', async () => {
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
    scenario!.fixture.reads[CHECKOUT.query] = { tickets: open(9, 'c'), incomplete: true }
    scenario!.fixture.reads[SEARCH.query] = { failure: 'unavailable' }
    scenario!.asked.length = 0
    summary()
    scenario!.inputs()

    expect(scenario!.asked).toEqual([])
    await readPicks(scenario!.using, TEAM, READ_AT)
    const view = summary()
    expect(view).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: '#57 Search revamp' }] } })
    expect(view.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
  })

  test('are none for a query written by hand', async () => {
    await picked([[CHECKOUT, open(3, 'c')]])
    const written = 'milestone:"Checkout v2" -label:wontfix'
    scenario!.fixture.reads[written] = { tickets: open(3), incomplete: false }
    await submitStepQuery(scenario!.using, TEAM, { kind: 'editQuery', query: written }, READ_AT)
    scenario!.asked.length = 0
    await readPicks(scenario!.using, TEAM, READ_AT)

    expect(scenario!.asked).toEqual([])
    expect(summary()).toMatchObject({ milestone: { query: written } })
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
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    return setupView(settingUp(scenario!), TEAM)
  }
  const FINISHED = finishedOn('f', '2026-11-10', 2)

  test('are none for a working setup', async () => {
    expect(await summaryWith({ tickets: [...open(3), ...FINISHED], incomplete: false }, { tickets: FINISHED, incomplete: false })).toMatchObject({ flags: [] })
  })

  test('say when the milestone query matches nothing', async () => {
    expect(await summaryWith({ tickets: [], incomplete: false })).toMatchObject({
      flags: [{ of: 'milestone', flag: 'This query matches nothing: no open tickets, and none finished in the last 9 weeks. Check it picks out the milestone’s tickets.' }],
    })
  })

  test('say when a read is incomplete, the milestone’s or comparable work’s', async () => {
    const view = await summaryWith({ tickets: open(3), incomplete: true }, { tickets: FINISHED, incomplete: true })
    const flag = 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.'
    expect(view).toMatchObject({ flags: [{ of: 'milestone', flag }, { of: 'comparable', flag }] })
  })

  test('say when comparable work’s query matches nothing finished, so pace is the milestone’s own', async () => {
    expect(await summaryWith({ tickets: open(3), incomplete: false }, { tickets: open(2, 'c'), incomplete: false })).toMatchObject({
      flags: [
        {
          of: 'comparable',
          flag: 'This query matches nothing finished in the last 9 weeks, so pace comes from the milestone’s own tickets. Check it picks out work like the milestone’s.',
        },
      ],
    })
  })
})

describe('Change', () => {
  test('reopens the steps at Milestone, with the team’s connection and queries as they were', async () => {
    const { connect, pick, storage } = team()
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })).toEqual({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone', next: { step: 'comparableWork' } })
    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).toMatchObject({ next: { step: 'check', label: 'next' } })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe('milestone:"Checkout v2"')
    expect(storage.comparableWorkQuery(TEAM)?.query).toBe('milestone:"Q3 polish"')
  })
})

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
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    return scenario!
  }
  const readAgain = () => submitReadAgain({ ...scenario!.using, timeZone: 'UTC' }, TEAM, LATER)

  test('reads the milestone query and comparable work’s, and the summary’s read time updates', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-11', 4), incomplete: false }

    expect(await readAgain()).toEqual({ kind: 'read' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', readOn: '12 Nov 14:30', flags: [] })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: LATER, tickets: { length: 4 } })
  })

  test('updates a value following the tracker, and leaves a typed one as typed', async () => {
    const { fixture, submit } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }

    await readAgain()
    expect(scenario!.inputs().milestone.ticketsSource).toMatchObject({ source: 'typed', reading: { count: 5, readOn: '12 Nov 14:30' } })
    expect(scenario!.forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 30 })

    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    fixture.reads[CHECKOUT.query] = { tickets: open(7), incomplete: false }
    await readAgain()
    expect(scenario!.forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
  })

  test('reads each of several picks again, so each keeps its count on the summary', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await scenario!.pick(READ_AT, BUG)
    await readPicks(scenario!.using, TEAM, READ_AT)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    fixture.reads[BUG.query] = { tickets: open(4, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(4, 'b')], incomplete: false }

    await readAgain()
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({
      milestone: { picks: [{ name: 'Checkout v2', count: 3 }, { name: 'bug', count: 4 }] },
    })
  })

  test('reads nothing until setup is done', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    scenario!.asked.length = 0

    expect(await readAgain()).toEqual({ kind: 'unchanged' })
    expect(scenario!.asked).toEqual([])
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
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    return scenario!
  }
  const readAgain = () => submitReadAgain({ ...scenario!.using, timeZone: 'UTC' }, TEAM, LATER)

  test('of a tracker unreachable or rate-limited keeps the saved read in use, and the summary says why', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unavailable' }

    expect(await readAgain()).toEqual({
      kind: 'failed',
      view: expect.objectContaining({
        kind: 'summary',
        readOn: '12 Nov 09:05',
        flags: [{ flag: 'GitHub can’t be reached just now, or is limiting requests, so the last read stays in use. Try again in a few minutes.' }],
      }),
    })
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })).toMatchObject({ readAt: READ_AT, tickets: { length: 3 } })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ readOn: '12 Nov 09:05', flags: [] })
  })

  test('of a token refused says so, and offers Change, which opens the Connect step', async () => {
    const { fixture } = await setUp()
    fixture.reads[CHECKOUT.query] = { failure: 'unauthorised' }

    expect(await readAgain()).toMatchObject({
      kind: 'failed',
      view: {
        flags: [
          {
            flag: 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.',
            change: 'connect',
          },
        ],
      },
    })
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })).toEqual({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM, 'connect')).toMatchObject({ kind: 'steps', step: 'connect' })
  })

  test('with this computer’s keychain failing reads nothing, and the summary says why', async () => {
    await setUp()
    scenario!.asked.length = 0
    const keychainFailing = { ...scenario!.using, secrets: { ...scenario!.using.secrets, token: () => Promise.reject(new Error('locked')) } }

    expect(await submitReadAgain({ ...keychainFailing, timeZone: 'UTC' }, TEAM, LATER)).toMatchObject({
      kind: 'failed',
      view: { flags: [{ flag: expect.stringContaining('keychain couldn’t be used') }] },
    })
    expect(scenario!.asked).toEqual([])
  })

  test('of a query the tracker now rejects, or that reaches outside the repo, flags that query, keeping its saved read', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { failure: 'invalidQuery', message: 'The milestone Q3 polish doesn’t exist.' }

    expect(await readAgain()).toMatchObject({
      kind: 'failed',
      view: { readOn: '12 Nov 14:30', flags: [{ of: 'comparable', flag: 'GitHub rejected this query: The milestone Q3 polish doesn’t exist.' }] },
    })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: READ_AT })

    fixture.reads[CHECKOUT.query] = { failure: 'outOfScope' }
    expect(await readAgain()).toMatchObject({ view: { flags: [{ of: 'milestone', flag: expect.stringContaining('outside') }, { of: 'comparable' }] } })
  })
})

describe('skipping connecting', () => {
  test('closes setup to the inputs typed, as the MVP has them, until the EM connects a tracker', () => {
    team()

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'skipConnecting' })).toEqual({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toEqual({ kind: 'skipped' })
    expect(scenario!.inputs({ connected: false })).toEqual(scenario!.inputs())

    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'connect' })
  })
})

// What the EM chooses inside setup (#218) is held as a draft: nothing in it reaches the forecast or the Inputs values
// until "Use these" applies it all together, and Cancel throws it away.
describe('the draft', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`

  /** A team set up on GitHub, following its milestone's 3 open tickets, then setup opened again with Change. */
  async function setUpThenChange(): Promise<TrackerScenario> {
    const { connect, submit } = team()
    scenario!.fixture.reads[CHECKOUT.query] = { tickets: [...open(3), ...finishedOn('f', '2026-11-03', 2), ...finishedOn('g', '2026-10-27', 2)], incomplete: false }
    scenario!.fixture.reads[BOTH] = { tickets: open(7), incomplete: false }
    scenario!.fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete: false }
    await connect()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    submit({ kind: 'setTicketsSource', ticketsSource: 'tracker' })
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    return scenario!
  }

  /** A query step's submit made inside setup, through the draft. */
  const inSetup = (edit: StepQueryEdit, readAt = NEXT_READ_AT, stepQuery: StepQuery = MILESTONE_QUERY) =>
    submitStepQuery(throughDraft(scenario!.using), TEAM, edit, readAt, stepQuery)

  /** A query step as setup shows it, through the draft. */
  const stepInSetup = (stepQuery: StepQuery = MILESTONE_QUERY) =>
    queryStepView({ ...throughDraft(scenario!.using), at: { readAt: NEXT_READ_AT, today: TODAY, timeZone: 'UTC' } }, TEAM, '', { unlisted: true }, stepQuery)

  test('picks and a hand-written query made in setup leave the saved queries, saved reads and the forecast unchanged until "Use these"', async () => {
    const { storage, inputs, forecast } = await setUpThenChange()
    const before = { inputs: inputs(), forecast: forecast() }
    expect(before.forecast).toMatchObject({ kind: 'forecast', ticketsRemaining: 3 })

    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT], query: CHECKOUT.query })
    expect(storage.comparableWorkQuery(TEAM)).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.readAt).toBe(READ_AT)
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
  })

  test('a first setup’s picks reach nothing either, until "Use these"', async () => {
    const { connect, storage, inputs } = team()
    await connect()
    const before = inputs()

    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(storage.milestoneQuery(TEAM)).toBeUndefined()
    expect(inputs()).toEqual(before)
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ step: 'milestone', next: { step: 'comparableWork' } })
    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(CHECKOUT.query)
  })

  test('"Use these" applies the draft’s queries and reads together, and closes setup', async () => {
    const { storage, forecast } = await setUpThenChange()
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toEqual({ saved: true })

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [CHECKOUT, Q3_POLISH], query: BOTH })
    expect(storage.comparableWorkQuery(TEAM)).toEqual({ picks: [Q3_POLISH], query: Q3_POLISH.query })
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toMatchObject({ readAt: NEXT_READ_AT, tickets: open(7) })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })?.readAt).toBe(NEXT_READ_AT)
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', readOn: '13 Nov 10:00' })
  })

  test('Cancel discards the draft: the Inputs view and the Milestone forecast view are as they were before setup opened', async () => {
    const { storage, inputs, forecast } = await setUpThenChange()
    const before = { inputs: inputs(), forecast: forecast() }
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })).toEqual({ saved: true })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', readOn: '12 Nov 09:05' })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(await stepInSetup()).toMatchObject({ query: CHECKOUT.query, picks: [CHECKOUT], read: '3 open · 4 finished in the last 9 weeks' })
  })

  test('Cancel is offered once setup opens again from its summary, and not in a first setup, where it is refused', async () => {
    const { connect } = team()
    await connect()
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(setupView(settingUp(scenario!), TEAM)).not.toHaveProperty('cancel')
    expect(submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })).toEqual({ saved: false })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })

    submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone', cancel: true })
    expect(setupView(settingUp(scenario!), TEAM, 'check')).toMatchObject({ step: 'check', cancel: true })
  })

  test('a query edit in setup is read at once, and the step shows its read and flags, from the draft', async () => {
    await setUpThenChange()
    scenario!.fixture.reads['is:open'] = { tickets: open(2), incomplete: true }

    expect(await inSetup({ kind: 'editQuery', query: BOTH })).toMatchObject({ kind: 'saved', read: { ok: true } })
    expect(await stepInSetup()).toMatchObject({ query: BOTH, read: '7 open · 0 finished in the last 9 weeks' })

    await inSetup({ kind: 'editQuery', query: 'is:open' })
    expect(await stepInSetup()).toMatchObject({ query: 'is:open', flag: expect.stringContaining('gave only part') })
  })

  test('a query refused in setup leaves the draft as it was', async () => {
    const { storage } = await setUpThenChange()
    scenario!.fixture.reads['closed:>2026-13-45'] = { failure: 'invalidQuery', message: 'Invalid date' }
    await inSetup({ kind: 'editQuery', query: BOTH })
    const draft = storage.setupDraft(TEAM)

    expect(await inSetup({ kind: 'editQuery', query: 'closed:>2026-13-45' })).toMatchObject({ kind: 'refused' })
    expect(await inSetup({ kind: 'editQuery', query: 'label:checkout payments' })).toMatchObject({ kind: 'refused' })

    expect(storage.setupDraft(TEAM)).toEqual(draft)
    expect(await stepInSetup()).toMatchObject({ query: BOTH })
  })
})
