import { beforeEach, describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import type { Choice, Ticket } from '../../src/connectors/connector.js'
import type { ComparableWorkPace, InputsEdit } from '../../src/forecast/index.js'
import { forecastingForTest, type ForecastingForTest } from './forecastingForTest.js'

// The Comparable work step's pace (#204): the pace in use, how far it is from the milestone's own, the two paired
// period by period, and each pick's own counts.

// Today, Thursday 12 Nov, 09:00, when each read is made: it reaches back 9 weeks (8 whole weeks and the current one), to
// 09:00 on Thursday 10 Sep.

// The weeks both reads reach whole, from the milestone's start on Thursday 1 Oct: the weeks of 17 and 24 Sep, before
// it started, then six of its own; the current week, of 12 Nov, is left out.
const WEEKS = ['2026-09-17', '2026-09-24', '2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29', '2026-11-05']

/** Tickets finished `counts[i]` times in the week starting `WEEKS[i]`, on its Friday, with ids `prefix1`, `prefix2`… */
function finished(prefix: string, counts: number[]): Ticket[] {
  const friday = (week: string): string => `${week.slice(0, 8)}${String(Number(week.slice(8)) + 1).padStart(2, '0')}T10:00:00Z`
  let id = 0
  return counts.flatMap((count, week) => Array.from({ length: count }, () => ({ id: `${prefix}${++id}`, finishedAt: friday(WEEKS[week] ?? '') })))
}

const checkout: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }
const slow: Choice = { kind: 'label', name: 'slow', query: 'label:"slow"' }
const fast: Choice = { kind: 'label', name: 'fast', query: 'label:"fast"' }
const even: Choice = { kind: 'label', name: 'even', query: 'label:"even"' }
const idle: Choice = { kind: 'label', name: 'idle', query: 'label:"idle"' }
const shared: Choice = { kind: 'label', name: 'shared', query: 'label:"shared"' }

// the milestone's own: 0 before it started, then 3.5 a week over its six weeks
const OWN = [0, 0, 3, 4, 3, 4, 3, 4]
const SLOW = [2, 2, 2, 1, 2, 2, 1, 2]
const FAST = [5, 5, 6, 5, 6, 5, 6, 5]
const EVEN = [3, 3, 4, 3, 3, 4, 4, 3]
// two of slow's tickets, s1 and s2 (in the week of 17 Sep), and one of its own in the week of 15 Oct
const SHARED_TICKETS = [...finished('s', SLOW).slice(0, 2), { id: 'h1', finishedAt: '2026-10-16T10:00:00Z' }]

const FIXTURE: CannedFixture = {
  milestoneChoices: [
    { kind: 'milestone', choices: [checkout], pastLimit: false },
    { kind: 'label', choices: [slow, fast, even, idle], pastLimit: false },
  ],
  reads: {
    [checkout.query]: { tickets: [{ id: 'm-open' }, ...finished('m', OWN)], incomplete: false },
    [slow.query]: { tickets: [{ id: 's-open' }, ...finished('s', SLOW)], incomplete: false },
    [fast.query]: { tickets: finished('f', FAST), incomplete: false },
    [even.query]: { tickets: finished('e', EVEN), incomplete: false },
    [idle.query]: { tickets: [{ id: 'i-open' }], incomplete: false },
    [shared.query]: { tickets: SHARED_TICKETS, incomplete: false },
    [`${slow.query} OR ${shared.query}`]: { tickets: [{ id: 's-open' }, ...finished('s', SLOW), ...SHARED_TICKETS.slice(2)], incomplete: false },
  },
}

let team: ForecastingForTest
/** Each query the tracker was asked to read. */
let asked: string[]

/**
 * Connected to GitHub, in the team's first setup, so what the steps pick is held in its draft, as the Comparable work
 * step shows it; the milestone starting on Thursday 1 Oct, its query Checkout v2's milestone.
 */
beforeEach(async () => {
  team = await forecastingForTest({ fixture: { ...FIXTURE, reads: { ...FIXTURE.reads } }, connected: true, setupOpen: true })
  asked = team.calls.reads
  await startOn('2026-10-01')
  await pickIn('milestone', checkout)
})

const submit = (edit: InputsEdit) => team.submit({ form: 'inputs', edit })

const startOn = (startDate: string) => submit({ kind: 'setMilestone', name: 'Checkout v2', startDate, ticketsRemaining: '30' })

const pickIn = (step: 'milestone' | 'comparableWork', choice: Choice) => team.submit({ form: 'stepQuery', step, edit: { kind: 'addPick', choice } })

const removeFrom = (step: 'milestone' | 'comparableWork', choice: Choice) =>
  team.submit({ form: 'stepQuery', step, edit: { kind: 'removePick', query: choice.query } })

const addComparable = (choice: Choice) => pickIn('comparableWork', choice)

/** Forgets the reads asked for so far, to count those after. */
const forgetAsked = () => void asked.splice(0)

/** The tracker's read of `query` from now on answering `read`. */
const reading = (query: string, read: CannedFixture['reads'][string]) => void (team.fixture.reads[query] = read)

/** The pace the Comparable work step's view leads with. */
async function paceOf(): Promise<ComparableWorkPace | undefined> {
  const { step } = await team.inputsScreen({ step: 'comparableWork' })
  return step?.kind === 'comparableWorkStep' ? step.pace : undefined
}

describe('the pace in use', () => {
  test('comparable work slower than the milestone’s own: its median and range, and how far below the milestone’s own', async () => {
    await addComparable(slow)

    expect(await paceOf()).toMatchObject({
      inUse: { from: 'comparableWork', median: 2, low: 1, high: 2 },
      comparison: { versus: { kind: 'slower', by: 1.5 }, ownMedian: 3.5 },
      said: {
        inUse: '2 a week',
        from: 'pace, from comparable work, range 1–2',
        comparison: '↓ 1.5 a week slower than the milestone’s own so far (3.5 a week)',
      },
    })
  })

  test('comparable work faster than the milestone’s own: how far above it', async () => {
    await addComparable(fast)

    expect(await paceOf()).toMatchObject({
      inUse: { from: 'comparableWork', median: 5, low: 5, high: 6 },
      comparison: { versus: { kind: 'faster', by: 1.5 }, ownMedian: 3.5 },
      said: { inUse: '5 a week', comparison: '↑ 1.5 a week faster than the milestone’s own so far (3.5 a week)' },
    })
  })

  test('within 0.5 a period of the milestone’s own, about the same', async () => {
    await addComparable(even)

    expect(await paceOf()).toMatchObject({
      comparison: { versus: { kind: 'aboutTheSame' }, ownMedian: 3.5 },
      said: { comparison: 'About the same as the milestone’s own so far (3.5 a week).' },
    })
  })

  test('with under 3 periods of its own, the milestone has too few to compare', async () => {
    await startOn('2026-10-29')
    await addComparable(slow)

    expect(await paceOf()).toMatchObject({
      inUse: { from: 'comparableWork', median: 2 },
      comparison: { versus: { kind: 'tooFewToCompare' }, ownPeriods: 2 },
      said: { comparison: 'The milestone has 2 weeks of its own so far: too few to compare.' },
    })
  })

  test('with 3 periods of its own, the milestone is compared', async () => {
    await startOn('2026-10-22')
    await addComparable(slow)

    expect(await paceOf()).toMatchObject({ comparison: { versus: { kind: 'slower', by: 2 }, ownMedian: 4 } })
  })

  test('with no comparable-work query, the milestone’s own is the headline, compared with nothing', async () => {
    const pace = await paceOf()

    expect(pace).toMatchObject({
      inUse: { from: 'milestone', median: 3.5, low: 3, high: 4 },
      said: { inUse: '3.5 a week', from: 'pace, from the milestone’s own tickets, range 3–4' },
    })
    expect(pace?.comparison).toBeUndefined()
  })

  test('a comparable-work query matching nothing finished leaves the milestone’s own as the headline', async () => {
    await addComparable(idle)

    expect(await paceOf()).toMatchObject({ inUse: { from: 'milestone', median: 3.5 } })
    expect((await paceOf())?.comparison).toBeUndefined()
  })

  test('a comparable-work query finishing nothing in the periods pace counts is flagged as not used', async () => {
    await addComparable(idle)

    expect((await paceOf())?.flag).toBe(
      'This query matches nothing finished in the 8 whole weeks pace counts, so pace comes from the milestone’s own tickets. Check it picks out work like the milestone’s.',
    )
  })

  test('a comparable-work query in use, or none, is not flagged', async () => {
    expect((await paceOf())?.flag).toBeUndefined()

    await addComparable(slow)

    expect((await paceOf())?.flag).toBeUndefined()
  })

  test('a sprint’s pace is said a sprint', async () => {
    await submit({ kind: 'setCadence', cadenceDays: '14' })
    await addComparable(slow)

    expect((await paceOf())?.said.comparison).toMatch(/a sprint slower than the milestone’s own so far \(.* a sprint\)$/)
  })

  test('none before the milestone query is read', async () => {
    await removeFrom('milestone', checkout)

    expect(await paceOf()).toBeUndefined()
  })
})

describe('the milestone query’s read incomplete', () => {
  test('pace comes from comparable work, compared with nothing, each period without the milestone’s own', async () => {
    reading(checkout.query, { tickets: finished('m', OWN), incomplete: true })
    await removeFrom('milestone', checkout)
    await pickIn('milestone', checkout)
    await addComparable(slow)

    const pace = await paceOf()

    expect(pace).toMatchObject({ inUse: { from: 'comparableWork', median: 2 }, said: { inUse: '2 a week' } })
    expect(pace?.comparison).toBeUndefined()
    expect(pace?.periods).toEqual(WEEKS.map((start, at) => ({ start, comparableWork: SLOW[at], beforeStart: at <= 1 })))
  })
})

describe('the periods paired', () => {
  test('comparable work beside the milestone’s own in each period, those before the milestone started marked', async () => {
    await addComparable(slow)

    expect((await paceOf())?.periods).toEqual(WEEKS.map((start, at) => ({ start, milestone: OWN[at], comparableWork: SLOW[at], beforeStart: at <= 1 })))
  })

  test('with no comparable-work query, the milestone’s own alone', async () => {
    expect((await paceOf())?.periods).toEqual(WEEKS.map((start, at) => ({ start, milestone: OWN[at], beforeStart: at <= 1 })))
  })

  test('the last 8 periods at most', async () => {
    await submit({ kind: 'setCadence', cadenceDays: '3' })

    expect((await paceOf())?.periods).toHaveLength(8)
  })
})

describe('each pick', () => {
  test('one pick: its strip of the periods paired, and how many it finished', async () => {
    await addComparable(slow)

    expect((await paceOf())?.picks).toEqual([{ query: slow.query, strip: SLOW, finished: 14 }])
  })

  test('several picks: each one’s, and how many only it brings in; a ticket two share is only here for neither', async () => {
    await addComparable(slow)
    await addComparable(shared)

    expect((await paceOf())?.picks).toEqual([
      { query: slow.query, strip: SLOW, finished: 14, onlyHere: 12 },
      { query: shared.query, strip: [2, 0, 0, 0, 1, 0, 0, 0], finished: 3, onlyHere: 1 },
    ])
  })

  test('a pick whose own read is incomplete has no chip pace, and only-here is unknown for the rest', async () => {
    reading(shared.query, { tickets: SHARED_TICKETS, incomplete: true })
    await addComparable(slow)
    await addComparable(shared)

    expect((await paceOf())?.picks).toEqual([{ query: slow.query, strip: SLOW, finished: 14 }])
  })

  test('removing a pick leaves the rest', async () => {
    await addComparable(slow)
    await addComparable(shared)
    await removeFrom('comparableWork', slow)

    expect((await paceOf())?.picks).toEqual([{ query: shared.query, strip: [2, 0, 0, 0, 1, 0, 0, 0], finished: 3 }])
  })
})

describe('what the tracker is asked', () => {
  test('nothing for the pace: it comes from the saved reads', async () => {
    await addComparable(slow)
    forgetAsked()

    await paceOf()

    expect(asked).toEqual([])
  })

  test('with several picks, comparable work’s read also reads each pick, once', async () => {
    await addComparable(slow)
    forgetAsked()

    await addComparable(shared)

    expect(asked).toEqual([`${slow.query} OR ${shared.query}`, slow.query, shared.query])
  })

  test('with one pick, its read is comparable work’s, read once', async () => {
    await addComparable(slow)

    expect(asked).toEqual([checkout.query, slow.query])
  })

  test('the milestone query’s picks are not read one by one', async () => {
    forgetAsked()

    await pickIn('milestone', shared)

    expect(asked).toEqual([`${checkout.query} OR ${shared.query}`])
  })
})
