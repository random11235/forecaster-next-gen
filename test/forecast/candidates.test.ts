import { assert, beforeEach, describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import { COMPARABLE_WORK, type Candidates, type InputsOpening, type QueryStep } from '../../src/forecast/index.js'
import { forecastingForTest, type ForecastingForTest } from './forecastingForTest.js'

// Candidates for comparable work (#205): read on demand, each grouped slower, about the same or faster than the
// milestone's own, or nothing finished.

// Today, Thursday 12 Nov, 09:00, when each read is made: it reaches back 9 weeks (8 whole weeks and the current one), to
// 09:00 on Thursday 10 Sep, so the weeks it reaches whole start on 17 Sep. The tickets here finish from the week of 24 Sep.
const WEEKS = ['2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const payments: Choice = { kind: 'label', name: 'payments', query: 'label:"payments"' }
const rewards: Choice = { kind: 'label', name: 'rewards', query: 'label:"rewards"' }
const bug: Choice = { kind: 'label', name: 'bug', query: 'label:"bug"' }
const docs: Choice = { kind: 'label', name: 'docs', query: 'label:"docs"' }
const broken: Choice = { kind: 'label', name: 'broken', query: 'label:"broken"' }
const partial: Choice = { kind: 'label', name: 'partial', query: 'label:"partial"' }
const loyalty: Choice = { kind: 'label', name: 'loyalty', query: 'label:"loyalty"' }
const release: Choice = { kind: 'label', name: 'release', query: 'label:"release"' }
const refunds: Choice = { kind: 'label', name: 'refunds', query: 'label:"refunds"' }

/** Tickets `prefix`1… finished at 10:00 on the Friday of each week in `WEEKS`, `counts[week]` of them. */
function finishedIn(prefix: string, counts: number[]): Ticket[] {
  let n = 0
  return counts.flatMap((count, week) =>
    Array.from({ length: count }, () => ({ id: `${prefix}${++n}`, finishedAt: `${addDays(WEEKS[week] ?? '', 1)}T10:00:00Z` })),
  )
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

// The milestone started on 1 Oct: six weeks of its own, 2 a week at the median.
const MILESTONE_TICKETS = [{ id: 'm-open1' }, { id: 'm-open2' }, ...finishedIn('m', [0, 2, 2, 1, 2, 3, 2])]
const PAYMENTS_TICKETS = [{ id: 'p-open' }, ...finishedIn('p', [1, 1, 0, 1, 1, 0, 1])]
const REWARDS_TICKETS = finishedIn('r', [2, 2, 2, 3, 1, 2, 2])
// three of rewards' tickets, and two of its own
const LOYALTY_TICKETS = [...REWARDS_TICKETS.slice(0, 3), ...finishedIn('l', [0, 0, 0, 0, 0, 1, 1])]
const BUG_TICKETS = [{ id: 'b-open1' }, { id: 'b-open2' }, { id: 'b-open3' }, ...finishedIn('b', [4, 4, 5, 4, 3, 4, 4])]

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [payments, rewards, bug, docs, broken, partial, loyalty, release, refunds], pastLimit: false },
  ],
  reads: {
    [checkout.query]: { tickets: MILESTONE_TICKETS, incomplete: false },
    [payments.query]: { tickets: PAYMENTS_TICKETS, incomplete: false },
    [rewards.query]: { tickets: REWARDS_TICKETS, incomplete: false },
    [bug.query]: { tickets: BUG_TICKETS, incomplete: false },
    [docs.query]: { tickets: [{ id: 'd-open1' }, { id: 'd-open2' }], incomplete: false },
    [broken.query]: { failure: 'unavailable' },
    [partial.query]: { tickets: REWARDS_TICKETS, incomplete: true },
    [loyalty.query]: { tickets: LOYALTY_TICKETS, incomplete: false },
  },
}

let team: ForecastingForTest
/** Each query the tracker was asked to read, since the milestone query was picked. */
let reads: string[]

/**
 * Connected to GitHub, in the team's first setup, so what the steps pick is held in its draft, as the Comparable work
 * step shows it; the milestone starting on 1 Oct, its query Checkout v2's milestone.
 */
beforeEach(async () => {
  team = await forecastingForTest({ fixture: FIXTURE, connected: true, setupOpen: true })
  await startOn('2026-10-01')
  await pickIn('milestone', checkout)
  reads = team.calls.reads
  reads.splice(0)
})

const startOn = (startDate: string) => team.submit({ form: 'inputs', edit: { kind: 'setMilestone', name: 'Checkout v2', startDate, ticketsRemaining: '30' } })

const pickIn = (step: 'milestone' | 'comparableWork', choice: Choice) => team.submit({ form: 'stepQuery', step, edit: { kind: 'addPick', choice } })

const open = () => team.openCandidates()

/** The Comparable work step, opened as `opening` asks. */
const comparableWorkStep = async (opening: InputsOpening = {}): Promise<QueryStep | undefined> =>
  (await team.inputsScreen({ step: 'comparableWork', ...opening })).step

/** Each group's candidates, by name. */
const named = (candidates: Candidates) => candidates.groups.map(({ group, candidates }) => ({ group, names: candidates.map((each) => each.choice.name) }))

describe('a candidate’s read', () => {
  test('its last periods as a strip, its median and how it compares with the milestone’s own, finished, open and last finished', async () => {
    const candidates = await (await open()).read([payments])

    expect(candidates.groups).toEqual([
      {
        group: 'slower',
        candidates: [
          {
            choice: payments,
            thisMilestone: false,
            read: {
              strip: { counts: [0, 1, 1, 0, 1, 1, 0, 1], starts: ['2026-09-17', ...WEEKS] },
              median: 1,
              versus: { kind: 'slower', by: 1 },
              finished: 5,
              weeks: 9,
              lastFinished: '2026-11-06',
              open: 1,
            },
          },
        ],
      },
    ])
    expect(candidates.milestoneOwn).toBe(2)
  })

  test('grouped slower, about the same, faster and nothing finished, each by median; the milestone itself marked', async () => {
    const candidates = await (await open()).read([bug, docs, checkout, payments, rewards])

    expect(named(candidates)).toEqual([
      { group: 'slower', names: ['payments'] },
      { group: 'aboutTheSame', names: ['Checkout v2', 'rewards'] },
      { group: 'faster', names: ['bug'] },
      { group: 'nothingFinished', names: ['docs'] },
    ])
    expect(candidates.groups[1]?.candidates[0]?.thisMilestone).toBe(true)
    expect(candidates.groups[2]?.candidates[0]).toMatchObject({ read: { median: 4, versus: { kind: 'faster', by: 2 }, open: 3 } })
    expect(candidates.groups[3]?.candidates[0]).toMatchObject({ read: { finished: 0, open: 2 } })
    expect(candidates.groups[3]?.candidates[0]).not.toHaveProperty(['read', 'lastFinished'])
  })

  test('how many it adds that the picks don’t already count', async () => {
    await pickIn('comparableWork', rewards)

    const candidates = await (await open()).read([loyalty])

    expect(candidates.groups[0]?.candidates[0]).toMatchObject({ read: { finished: 5, adds: 2 } })
  })

  test('with no comparable work picked, adds is left out', async () => {
    const candidates = await (await open()).read([bug])

    expect(candidates.groups[0]?.candidates[0]).not.toHaveProperty(['read', 'adds'])
  })

  test('with too few periods of the milestone’s own to compare, listed by median, slowest first', async () => {
    await startOn('2026-10-29')

    const candidates = await (await open()).read([bug, docs, payments, rewards])

    expect(candidates.milestoneOwn).toBeUndefined()
    expect(named(candidates)).toEqual([
      { group: 'byMedian', names: ['payments', 'rewards', 'bug'] },
      { group: 'nothingFinished', names: ['docs'] },
    ])
    expect(candidates.groups[0]?.candidates[0]).toMatchObject({ read: { versus: { kind: 'tooFewToCompare' } } })
  })

  test('a read that fails shows why, and the candidate is still there to pick', async () => {
    const candidates = await (await open()).read([broken, partial])

    expect(candidates.groups).toEqual([
      {
        group: 'readFailed',
        candidates: [
          { choice: broken, thisMilestone: false, failure: 'GitHub couldn’t read it just now. Open it again in a few minutes.' },
          { choice: partial, thisMilestone: false, failure: 'GitHub gave only part of what it matches, so it isn’t counted.' },
        ],
      },
    ])
  })
})

describe('this milestone, in the step’s lists', () => {
  test('the choice that is the milestone query is marked, without reading it', async () => {
    const step = await comparableWorkStep()
    const searched = await team.searchedChoiceList('milestone', '', COMPARABLE_WORK)

    expect(step?.lists.map((list) => list.thisMilestone)).toEqual([checkout.query, undefined])
    expect(searched).toMatchObject({ thisMilestone: checkout.query })
    expect(reads).toEqual([])
  })

  test('none is marked when the milestone query is more than one choice', async () => {
    await pickIn('milestone', release)

    const step = await comparableWorkStep()

    expect(step?.lists.map((list) => list.thisMilestone)).toEqual([undefined, undefined])
  })
})

/** The candidates the Comparable work step's view shows, opened with `find` typed and `opened`. */
async function shownBy(find: string, opened: string[] = []) {
  const step = await comparableWorkStep({ find: { comparableWork: find }, opened })
  return step?.kind === 'comparableWorkStep' ? step.candidates : undefined
}

describe('reading on demand', () => {
  test('opening the step reads no candidate, and shows none', async () => {
    const candidates = await shownBy('')

    expect(reads).toEqual([])
    expect(candidates?.shown).toEqual({
      groups: [],
      milestoneOwn: 2,
      period: 'week',
      kindNames: { milestone: 'milestone', fixVersion: 'fix version', epic: 'epic', label: 'label' },
    })
  })

  test('the step’s view reads the candidates the EM opened, among its lists, and shows them grouped', async () => {
    const candidates = await shownBy('', [payments.query, 'label:"not listed"'])

    expect(reads).toEqual([payments.query])
    expect(candidates && named(candidates.shown)).toEqual([{ group: 'slower', names: ['payments'] }])
  })

  test('the step’s view reads those its find box narrows its lists to, when they are a few', async () => {
    const candidates = await shownBy('r')

    expect(reads).toEqual([rewards.query, broken.query, partial.query, release.query, refunds.query])
    expect(candidates && named(candidates.shown).map(({ group }) => group)).toEqual(['aboutTheSame', 'nothingFinished', 'readFailed'])
  })

  test('the step’s opening reads more in, each once', async () => {
    const candidates = await shownBy('', [payments.query])

    assert(candidates, 'the step shows candidates')
    const more = await candidates.opening.read([payments, rewards])

    expect(reads).toEqual([payments.query, rewards.query])
    expect(named(more)).toEqual([
      { group: 'slower', names: ['payments'] },
      { group: 'aboutTheSame', names: ['rewards'] },
    ])
  })

  test('with its query open for editing, the step shows no candidates and reads none', async () => {
    const step = await comparableWorkStep({ find: { comparableWork: 'r' }, editing: 'comparableWork' })

    expect(reads).toEqual([])
    expect(step).toMatchObject({ kind: 'comparableWorkStep' })
    expect(step).not.toHaveProperty('candidates')
  })

  test('opening one candidate reads only it', async () => {
    await (await open()).read([payments])

    expect(reads).toEqual([payments.query])
  })

  test('each is read at most once per opening, and kept for the opening', async () => {
    const opening = await open()
    await opening.read([payments])
    const candidates = await opening.read([payments, rewards])

    expect(reads).toEqual([payments.query, rewards.query])
    expect(named(candidates)).toEqual([
      { group: 'slower', names: ['payments'] },
      { group: 'aboutTheSame', names: ['rewards'] },
    ])
  })

  test('a new opening reads afresh', async () => {
    await (await open()).read([payments])
    await (await open()).read([payments])

    expect(reads).toEqual([payments.query, payments.query])
  })

  test('typing that leaves more than a few reads nothing', async () => {
    const candidates = await shownBy('e')

    expect(reads).toEqual([])
    expect(candidates?.shown.groups).toEqual([])
  })
})
