import { afterEach, describe, expect, test } from 'vitest'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { followRenamedMilestone } from '../../src/forecast/milestoneRenamed.js'
import { NO_CANCEL, openSetup, setupView, submitSetup, type ChosenSource, type SetupContext, type SetupEdit } from '../../src/forecast/setup.js'
import type { SetupStep } from '../../src/forecast/setupSteps.js'
import { submitReadAgain } from '../../src/forecast/setupReads.js'
import { COUNTS_WAIT } from '../../src/forecast/setupSummary.js'
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
  scenario = trackerScenario({ firstSetup: true })
  scenario.fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH], pastLimit: false }]
  scenario.fixture.reads[Q3_POLISH.query] = { tickets: [], incomplete: false }
  return scenario
}

const settingUp = ({ using }: TrackerScenario): SetupContext => ({ ...using, timeZone: 'UTC', today: TODAY })

/** The Inputs screen opened at Check, as at `readAt`, which reads each pick the summary has no count for yet. */
const atCheck = (readAt = READ_AT) => openSetup(settingUp(scenario!), TEAM, { asked: 'check' }, readAt)

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
    const at = (step: SetupStep) => setupView(settingUp(scenario!), TEAM, step)

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
    const at = (step: SetupStep) => setupView(settingUp(scenario!), TEAM, step)

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
  })

  test('open, as the Inputs screen asks, at the step its URL names, or at a step whose form was just refused', async () => {
    const { connect, pick } = team()
    await connect()
    await pick(READ_AT)
    const opened = (opening: { asked?: string; refused?: SetupStep }) => openSetup(settingUp(scenario!), TEAM, opening, READ_AT)

    expect(await opened({ asked: 'comparableWork' })).toMatchObject({ step: 'comparableWork' })
    expect(await opened({ asked: 'nonsense' })).toMatchObject({ step: 'milestone' })
    expect(await opened({ asked: 'check', refused: 'connect' })).toMatchObject({ step: 'connect' })
  })

  test('go on, after a setup edit, to Check for a source, Connect for Change from a refused token, Milestone as the steps open there, else the screen as it opens', async () => {
    const { connect, pick } = team()
    const submit = (edit: SetupEdit) => submitSetup(settingUp(scenario!), TEAM, edit)
    expect(await submit({ kind: 'change' })).not.toHaveProperty('next')
    await connect()
    await pick(READ_AT)

    expect(await submit({ kind: 'chooseSource', value: 'pace', source: 'tracker' })).toMatchObject({ next: 'check' })
    expect(await submit({ kind: 'useThese' })).not.toHaveProperty('next')
    expect(await submit({ kind: 'change', at: 'connect' })).toMatchObject({ saved: true, next: 'connect' })
    expect(await submit({ kind: 'cancel' })).not.toHaveProperty('next')
    expect(await submit({ kind: 'change' })).toMatchObject({ saved: true, next: 'milestone' })
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

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: true })
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
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', tracker: 'Jira', where: 'shop.atlassian.net · SHOP' })
  })

  test('is refused, and setup stays open, until the team is connected and the milestone has a query', async () => {
    const { connect } = team()
    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: false })
    await connect()
    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: false })

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
  const summary = async () => (await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' }), setupView(settingUp(scenario!), TEAM))

  test('name the milestone’s and comparable work’s picks, in the order picked, each with its kind', async () => {
    const { fixture } = await setUp([CHECKOUT, SEARCH])
    fixture.reads[Q3_POLISH.query] = { tickets: [{ id: 'q', finishedAt: '2026-11-10T00:00:00Z' }], incomplete: false }
    await scenario!.pick(READ_AT, BUG, COMPARABLE_WORK)
    await scenario!.pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)

    expect(await summary()).toMatchObject({
      milestone: { picks: [{ name: 'Checkout v2', kind: 'milestone' }, { name: '#57 Search revamp', kind: 'epic' }] },
      comparable: { picks: [{ name: 'bug', kind: 'label' }, { name: 'Q3 polish', kind: 'milestone' }] },
    })
  })

  test('show a query written by hand as written, and no Comparable row without comparable work', async () => {
    const { fixture } = await setUp()
    const written = 'milestone:"Checkout v2" -label:wontfix'
    fixture.reads[written] = { tickets: open(3), incomplete: false }
    await submitStepQuery(scenario!.using, TEAM, { kind: 'editQuery', query: written }, READ_AT)

    const view = await summary()
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

    expect(await summary()).toMatchObject({
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
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
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
    await picked([[VERSION, open(2, 'v')], [EPIC, open(6, 'e')]], 'jira')
    await atCheck()

    expect(await summary()).toMatchObject({ milestone: { picks: [{ name: '2.4', kind: 'fix version', count: 2 }, { name: 'SHOP-41 Checkout v2', kind: 'epic', count: 6 }] } })
  })

  test('are read once at Check: a pick read since its query was is not read again, as comparable work’s picks are when picked', async () => {
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
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
    expect(await summary()).toMatchObject({ comparable: { picks: [{ name: 'bug', count: 2 }, { name: 'Q3 polish', count: 1 }] } })
  })

  test('are not read as the Inputs screen opens, and a pick whose read failed or is incomplete has none', async () => {
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
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
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
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
    await picked([[CHECKOUT, open(3, 'c')], [SEARCH, open(1, 's')]])
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
      flags: [{ of: 'milestoneQuery', flag: 'This query matches nothing: no open tickets, and none finished in the last 9 weeks. Check it picks out the milestone’s tickets.' }],
    })
  })

  test('say when a read is incomplete, the milestone’s or comparable work’s', async () => {
    const view = await summaryWith({ tickets: open(3), incomplete: true }, { tickets: FINISHED, incomplete: true })
    const flag = 'GitHub gave only part of what this query matches, so its tickets aren’t counted. Narrow the query to read all of it.'
    expect(view).toMatchObject({ flags: [{ of: 'milestoneQuery', flag }, { of: 'comparableWork', flag }] })
  })

  test('are only the query flags, an incomplete read and a failed read: none for comparable work finishing nothing', async () => {
    expect(await summaryWith({ tickets: open(3), incomplete: false }, { tickets: open(2, 'c'), incomplete: false })).toMatchObject({ flags: [] })
  })
})

describe('Change', () => {
  test('reopens the steps at Milestone, with the team’s connection and queries as they were', async () => {
    const { connect, pick, storage } = team()
    await connect()
    await pick(READ_AT)
    await pick(READ_AT, Q3_POLISH, COMPARABLE_WORK)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })).toMatchObject({ saved: true })
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
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    return scenario!
  }
  const readAgain = () => submitReadAgain(settingUp(scenario!), TEAM, LATER)

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

  test('reads the queries alone, not each of several picks: their counts show none until Check reads them again', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await scenario!.pick(READ_AT, BUG)
    await atCheck()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(4, 'b')], incomplete: false }
    scenario!.asked.length = 0

    await readAgain()
    expect(scenario!.asked).toHaveLength(2)
    const view = setupView(settingUp(scenario!), TEAM)
    expect(view).toMatchObject({ milestone: { picks: [{ name: 'Checkout v2' }, { name: 'bug' }], note: COUNTS_WAIT } })
    expect(view.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)).toBe(false)
  })

  test('leaves no note on a row whose picks’ counts are as Check read them, or of one pick', async () => {
    const BUG: Choice = { kind: 'label', name: 'bug', query: 'label:bug' }
    const { fixture } = await setUp()
    fixture.reads[BUG.query] = { tickets: open(2, 'b'), incomplete: false }
    fixture.reads[`${CHECKOUT.query} OR ${BUG.query}`] = { tickets: [...open(3), ...open(2, 'b')], incomplete: false }
    await readAgain()
    expect(setupView(settingUp(scenario!), TEAM)).not.toHaveProperty('milestone.note')

    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await scenario!.pick(READ_AT, BUG)
    await atCheck(LATER)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ milestone: { picks: [{ count: 3 }, { count: 2 }] } })
    expect(setupView(settingUp(scenario!), TEAM)).not.toHaveProperty('milestone.note')
  })

  test('reads nothing while setup is open again with Change', async () => {
    await setUp()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    scenario!.asked.length = 0

    expect(await readAgain()).toEqual({ kind: 'unchanged' })
    expect(scenario!.asked).toEqual([])
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
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    return scenario!
  }
  const readAgain = () => submitReadAgain(settingUp(scenario!), TEAM, LATER)
  const summary = () => setupView(settingUp(scenario!), TEAM)

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
    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })).toMatchObject({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM, 'connect')).toMatchObject({ kind: 'steps', step: 'connect' })
  })

  test('with this computer’s keychain failing reads nothing, and the summary says why', async () => {
    await setUp()
    scenario!.asked.length = 0
    const keychainFailing = { ...scenario!.using, secrets: { ...scenario!.using.secrets, token: () => Promise.reject(new Error('locked')) } }

    expect(await submitReadAgain(keychainFailing, TEAM, LATER)).toEqual({ kind: 'failed' })
    expect(summary()).toMatchObject({ flags: [{ flag: expect.stringContaining('keychain couldn’t be used') }] })
    expect(scenario!.asked).toEqual([])
  })

  test('of a query the tracker now rejects, or that reaches outside the repo, flags that query, keeping its saved read', async () => {
    const { fixture, storage } = await setUp()
    fixture.reads[CHECKOUT.query] = { tickets: open(5), incomplete: false }
    fixture.reads[Q3_POLISH.query] = { failure: 'invalidQuery', message: 'The milestone Q3 polish doesn’t exist.' }

    expect(await readAgain()).toEqual({ kind: 'failed' })
    expect(summary()).toMatchObject({ readOn: '12 Nov 14:30', flags: [{ of: 'comparableWork', flag: 'GitHub rejected this query: The milestone Q3 polish doesn’t exist.' }] })
    expect(storage.savedRead({ teamId: TEAM, query: Q3_POLISH.query })).toMatchObject({ readAt: READ_AT })

    fixture.reads[CHECKOUT.query] = { failure: 'outOfScope' }
    await readAgain()
    expect(summary()).toMatchObject({ flags: [{ of: 'milestoneQuery', flag: expect.stringContaining('outside') }, { of: 'comparableWork' }] })
  })
})

describe('skipping connecting', () => {
  test('closes setup to the inputs typed, as the MVP has them, until the EM connects a tracker', async () => {
    team()

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'skipConnecting' })).toMatchObject({ saved: true })
    expect(setupView(settingUp(scenario!), TEAM)).toEqual({ kind: 'skipped' })
    expect(scenario!.inputs({ connected: false })).toEqual(scenario!.inputs())

    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
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
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    return scenario!
  }

  /** A query step's submit made inside setup, through the draft. */
  const inSetup = (edit: StepQueryEdit, readAt = NEXT_READ_AT, stepQuery: StepQuery = MILESTONE_QUERY) =>
    submitStepQuery(scenario!.using, TEAM, edit, readAt, stepQuery)

  /** A query step as setup shows it, through the draft. */
  const stepInSetup = (stepQuery: StepQuery = MILESTONE_QUERY) =>
    queryStepView({ ...scenario!.using, at: { readAt: NEXT_READ_AT, today: TODAY, timeZone: 'UTC' } }, TEAM, '', { unlisted: true }, stepQuery)

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
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(CHECKOUT.query)
  })

  test('"Use these" applies the draft’s queries and reads together, and closes setup', async () => {
    const { storage, forecast } = await setUpThenChange()
    await inSetup({ kind: 'editQuery', query: BOTH })
    await inSetup({ kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: true })

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

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })).toMatchObject({ saved: true })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'summary', readOn: '12 Nov 09:05' })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(await stepInSetup()).toMatchObject({ query: CHECKOUT.query, picks: [CHECKOUT], read: '3 open · 4 finished in the last 9 weeks' })
  })

  test('Cancel in a first setup discards the draft and the connection made in it: the team is as it was before setup opened', async () => {
    const { connect, storage, using, inputs, forecast } = team()
    const before = { inputs: inputs(), forecast: forecast() }
    await connect()
    await inSetup({ kind: 'addPick', choice: CHECKOUT }, READ_AT)

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })).toMatchObject({ saved: true })

    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(await using.secrets.token(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'connect' })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)
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

  test('a skip in setup reads the draft’s queries back too, into the draft, as well as the saved ones', async () => {
    const { storage, submit } = await setUpThenChange()
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-07', ticketsRemaining: '30' })
    await inSetup({ kind: 'editQuery', query: BOTH })
    scenario!.asked.length = 0

    await scenario!.skip(['2026-11-02'], NEXT_READ_AT)

    expect(scenario!.asked).toEqual(['2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z'])
    expect(storage.savedRead({ teamId: TEAM, query: BOTH })).toBeUndefined()
    expect(storage.savedRead({ teamId: TEAM, query: CHECKOUT.query })?.finishedSince).toBe('2026-09-04T10:00:00.000Z')
    expect(storage.setupDraft(TEAM)?.reads.find(({ query }) => query === BOTH)?.read.finishedSince).toBe('2026-09-04T10:00:00.000Z')
  })

  test('a milestone renamed in setup follows in the draft as well as the saved query', async () => {
    const V3: Choice = { kind: 'milestone', name: 'Checkout v3', query: 'milestone:"Checkout v3"' }
    const { storage, fixture } = await setUpThenChange()
    fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, V3, Q3_POLISH], pastLimit: false }]
    fixture.reads[V3.query] = { tickets: open(4), incomplete: false }
    await inSetup({ kind: 'removePick', query: CHECKOUT.query })
    await inSetup({ kind: 'addPick', choice: CHECKOUT })

    await followRenamedMilestone(scenario!.using, TEAM, { from: CHECKOUT.name, to: V3.name }, NEXT_READ_AT)

    expect(storage.milestoneQuery(TEAM)).toEqual({ picks: [V3], query: V3.query })
    expect(storage.setupDraft(TEAM)?.milestoneQuery).toEqual({ picks: [V3], query: V3.query })
    expect(await stepInSetup()).toMatchObject({ picks: [V3], read: '4 open · 0 finished in the last 9 weeks' })
  })
})

// Cancel puts setup back as it was before its steps opened: the summary, connecting skipped, or a first setup's
// steps; a connection made in the steps goes with it, one there before them stays.
describe('Cancel', () => {
  const cancel = () => submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })

  test('after Skip, then Change and Connect, removes the connection made and returns to connecting skipped', async () => {
    const { connect, storage } = team()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'skipConnecting' })
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    await connect()

    expect(await cancel()).toMatchObject({ saved: true })
    expect(storage.connection(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario!), TEAM)).toEqual({ kind: 'skipped' })
  })

  test('in a team connected before setup’s steps came (#217), with no milestone query, keeps its connection', async () => {
    const { connect, storage } = team()
    await connect()
    // as migration 20 leaves such a team: setup open, with no connection made in it
    storage.saveSetupState(TEAM, { open: true })
    await scenario!.pick(READ_AT)

    expect(await cancel()).toMatchObject({ saved: true })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'github', repo: 'shop' })
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', step: 'milestone' })
  })

  test('is refused once the connection the steps opened on is changed in them, and the step says why in its place', async () => {
    const { connect, pick, storage } = team()
    await connect()
    await pick(READ_AT)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(setupView(settingUp(scenario!), TEAM)).not.toHaveProperty('noCancel')

    await connect('jira')

    expect(setupView(settingUp(scenario!), TEAM)).toMatchObject({ kind: 'steps', noCancel: NO_CANCEL })
    expect(await cancel()).toMatchObject({ saved: false })
    expect(storage.connection(TEAM)).toMatchObject({ tracker: 'jira' })
    expect(storage.setupState(TEAM)).toMatchObject({ open: true })
  })

  test('in a first setup, still removes a connection made there and then changed', async () => {
    const { connect, storage } = team()
    await connect()
    await connect('jira')

    expect(setupView(settingUp(scenario!), TEAM)).not.toHaveProperty('noCancel')
    expect(await cancel()).toMatchObject({ saved: true })
    expect(storage.connection(TEAM)).toBeUndefined()
  })
})

// Check (#220): for each value the tracker can supply, the EM's value now, the tracker's reading from the draft reads,
// and which to use. "Use these" applies the draft and the sources chosen together.
describe('Check', () => {
  const NEXT_READ_AT = '2026-11-13T10:00:00Z'
  const BOTH = `${CHECKOUT.query} OR ${Q3_POLISH.query}`

  /**
   * A team set up on `to`, its milestone typed as 30 tickets with a pace range of 4–8, following nothing; setup
   * opened again with Change, the milestone query edited there to read 7 open tickets, and Q3 polish, finished 6 in
   * w/c 2 Nov, picked as comparable work.
   */
  async function changedInSetup({ to = 'github', incomplete = false }: { to?: 'github' | 'jira'; incomplete?: boolean } = {}): Promise<TrackerScenario> {
    const { connect, submit, fixture } = team()
    fixture.reads[CHECKOUT.query] = { tickets: open(3), incomplete: false }
    fixture.reads[BOTH] = { tickets: open(7), incomplete }
    fixture.reads[Q3_POLISH.query] = { tickets: finishedOn('q', '2026-11-03', 6), incomplete }
    await connect(to)
    submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
    submit({ kind: 'setPaceRange', low: '4', high: '8' })
    await scenario!.pick(READ_AT)
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    const drafted = scenario!.using
    await submitStepQuery(drafted, TEAM, { kind: 'editQuery', query: BOTH }, NEXT_READ_AT)
    await submitStepQuery(drafted, TEAM, { kind: 'addPick', choice: Q3_POLISH }, NEXT_READ_AT, COMPARABLE_WORK)
    return scenario!
  }
  const check = () => (setupView(settingUp(scenario!), TEAM, 'check') as { check?: unknown }).check
  const choose = (...[value, source]: [ChosenSource['value'], ChosenSource['source']]) => submitSetup(settingUp(scenario!), TEAM, { kind: 'chooseSource', value, source } as SetupEdit)

  test('shows the EM’s value now and the draft reading of tickets remaining and pace, each row on its current source', async () => {
    await changedInSetup()

    expect(check()).toMatchObject({
      tracker: 'GitHub',
      ticketsRemaining: { yours: 30, reading: 7, incomplete: false, source: 'typed' },
      pace: { yours: { source: 'range', range: { low: 4, high: 8 } }, reading: { counts: [6] }, incomplete: false, source: 'range', choices: ['tracker', 'range'] },
    })
  })

  test('offers the range beside the typed counts when pace is the EM’s typed counts, Yours showing the one chosen', async () => {
    const { submit, storage } = await changedInSetup()
    submit({ kind: 'setPaceCounts', counts: '5 6 7' })
    submit({ kind: 'setPaceMode', paceMode: 'counts' })

    expect(check()).toMatchObject({ pace: { yours: { source: 'counts', counts: [5, 6, 7] }, source: 'counts', choices: ['tracker', 'range', 'counts'] } })
    expect(await choose('pace', 'range')).toMatchObject({ saved: true })
    expect(check()).toMatchObject({ pace: { yours: { source: 'range', range: { low: 4, high: 8 } }, source: 'range' } })
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ paceMode: 'range', paceCounts: [5, 6, 7] })
  })

  test('is shown only at Check', async () => {
    await changedInSetup()

    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).not.toHaveProperty('check')
  })

  test('choosing the tracker for tickets and keeping the range for pace changes nothing until "Use these", which saves those sources and the draft together', async () => {
    const { storage, inputs, forecast } = await changedInSetup()
    const before = { inputs: inputs(), forecast: forecast() }

    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ saved: true })
    expect(await choose('pace', 'range')).toMatchObject({ saved: true })
    expect(check()).toMatchObject({ ticketsRemaining: { source: 'tracker' }, pace: { source: 'range' } })
    expect(inputs()).toEqual(before.inputs)
    expect(forecast()).toEqual(before.forecast)

    expect(await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })).toMatchObject({ saved: true })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'tracker', ticketsRemaining: 30, paceMode: 'range', paceRange: { low: 4, high: 8 } })
    expect(storage.milestoneQuery(TEAM)?.query).toBe(BOTH)
    expect(inputs().milestone.ticketsSource).toMatchObject({ source: 'tracker', reading: { count: 7 } })
    expect(forecast()).toMatchObject({ kind: 'forecast', ticketsRemaining: 7 })
  })

  test('the tracker chosen for pace and typed for tickets: pace follows the tracker, and tickets stay as typed', async () => {
    const { storage, inputs } = await changedInSetup()
    await choose('pace', 'tracker')
    await choose('ticketsRemaining', 'typed')
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed', ticketsRemaining: 30, paceMode: 'tracker', paceRange: { low: 4, high: 8 } })
    expect(inputs().milestone).toMatchObject({ paceUsed: 'tracker', ticketsRemaining: 30 })
  })

  test('keeps the choices made there through Back, and Cancel discards them', async () => {
    const { storage } = await changedInSetup()
    await choose('ticketsRemaining', 'tracker')
    await choose('pace', 'tracker')

    expect(setupView(settingUp(scenario!), TEAM, 'comparableWork')).toMatchObject({ step: 'comparableWork' })
    expect(check()).toMatchObject({ ticketsRemaining: { source: 'tracker' }, pace: { source: 'tracker' } })

    await submitSetup(settingUp(scenario!), TEAM, { kind: 'cancel' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed', paceMode: 'range' })
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'change' })
    expect(check()).toMatchObject({ ticketsRemaining: { source: 'typed', reading: 3 }, pace: { source: 'range' } })
  })

  test('refuses a source it doesn’t offer, changing nothing', async () => {
    const { storage } = await changedInSetup()
    const draft = storage.setupDraft(TEAM)

    expect(await choose('pace', 'counts')).toMatchObject({ saved: false })
    expect(storage.setupDraft(TEAM)).toEqual(draft)
  })

  test('refuses a choice once setup is closed', async () => {
    const { storage } = await changedInSetup()
    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })

    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ saved: false })
    expect(storage.setupDraft(TEAM)).toBeUndefined()
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ ticketsSource: 'typed' })
  })

  test('marks an incomplete draft read on its row', async () => {
    await changedInSetup({ incomplete: true })

    expect(check()).toMatchObject({ ticketsRemaining: { reading: 7, incomplete: true }, pace: { incomplete: true } })
    expect(check()).not.toHaveProperty('pace.reading')
  })

  test('names the team’s tracker, Jira', async () => {
    await changedInSetup({ to: 'jira' })

    expect(check()).toMatchObject({ tracker: 'Jira' })
  })

  test('with no milestone entered yet, starts on a new milestone’s sources, and "Use these" saves those chosen', async () => {
    const { connect, storage } = team()
    await connect()
    await scenario!.pick(READ_AT)

    expect(check()).toMatchObject({ ticketsRemaining: { reading: 0, source: 'typed' }, pace: { source: 'range', choices: ['tracker', 'range'] } })
    expect(await choose('ticketsRemaining', 'tracker')).toMatchObject({ saved: true })
    expect(await choose('pace', 'tracker')).toMatchObject({ saved: true })
    expect(storage.milestoneInputs(TEAM)).toBeUndefined()

    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toMatchObject({ name: '', ticketsSource: 'tracker', paceMode: 'tracker' })
  })

  test('with no milestone entered yet and its sources left as they start, "Use these" enters no milestone', async () => {
    const { connect, storage } = team()
    await connect()
    await scenario!.pick(READ_AT)
    await choose('ticketsRemaining', 'typed')

    await submitSetup(settingUp(scenario!), TEAM, { kind: 'useThese' })
    expect(storage.milestoneInputs(TEAM)).toBeUndefined()
  })
})
