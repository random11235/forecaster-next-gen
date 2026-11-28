import { describe, expect, test } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { CHECKOUT, pick } from './forecastingForTest.js'
import { finishedInWeeks, READ_AT, trackerPaceScenario } from './trackerPaceScenario.js'

// Pace following the tracker (#212): the pace graph, the milestone's own counts paired with comparable work's.
// Arranged through trackerPaceScenario.ts.

const scenario = trackerPaceScenario()
const { submit, inputs, forecast, connectGitHub, enterAndPick } = scenario

describe('the pace graph', () => {
  const like: Choice = { kind: 'label', name: 'checkout-like', query: 'label:"checkout-like"' }
  // the milestone started on Monday 5 Oct, so the weeks of 14, 21 and 28 Sep come before it
  const STARTED = '2026-10-05'
  const OWN = [5, 6, 4, 7, 5, 6, 8]
  const LIKE = [2, 3, 2, 3, 2, 3, 2]

  /** Follows GitHub, the milestone started on `STARTED`; with `comparable`, comparable work finished that many a week. */
  async function following(comparable: number[] | undefined): Promise<void> {
    await connectGitHub()
    scenario.team.fixture.milestoneChoices = [
      { kind: 'milestone', choices: [CHECKOUT], pastLimit: false },
      { kind: 'label', choices: [like], pastLimit: false },
    ]
    const likeTickets = finishedInWeeks(comparable ?? []).map((ticket) => ({ ...ticket, id: `like-${ticket.id}` }))
    scenario.team.fixture.reads[like.query] = { tickets: [{ id: 'like-open' }, ...likeTickets], incomplete: false }
    await enterAndPick()
    await submit({ kind: 'setMilestone', name: 'Checkout v2', startDate: STARTED, ticketsRemaining: '30' })
    if (comparable) await pick(scenario.team, READ_AT, like, 'comparableWork')
    await submit({ kind: 'setPaceMode', paceMode: 'tracker' })
  }

  const trendOf = (view: Awaited<ReturnType<typeof forecast>>) => (view.kind === 'forecast' ? view.paceTrend : undefined)

  test('with comparable work, it pairs its finished tickets with the milestone’s own each week, marking the weeks before the milestone started and the series pace comes from', async () => {
    await following(LIKE)

    // the read reaches 8 whole weeks, from 14 Sep: comparable work finished nothing in the last
    const counts = [...LIKE, 0]
    const paired = { from: 'comparableWork', comparableWork: counts, milestone: [3, ...OWN], beforeStart: 3 }
    expect((await inputs()).milestone.paceTrend).toMatchObject({ counts, paired })
    expect(trendOf(await forecast())).toMatchObject({ counts, paired })
  })

  test('with no comparable-work query, it shows the milestone’s own alone', async () => {
    await following(undefined)

    expect((await inputs()).milestone.paceTrend).toMatchObject({ counts: [4, 7, 5, 6, 8], paired: undefined })
    expect(trendOf(await forecast())).toMatchObject({ counts: [4, 7, 5, 6, 8], paired: undefined })
  })

  test('with comparable work that finished nothing, pace falls back to the milestone’s own, paired with comparable work’s quiet weeks', async () => {
    await following([0, 0, 0, 0, 0, 0, 0])

    expect((await inputs()).milestone.paceTrend).toMatchObject({
      counts: [4, 7, 5, 6, 8],
      paired: { from: 'milestone', comparableWork: [0, 0, 0, 0, 0], milestone: [4, 7, 5, 6, 8], beforeStart: 0 },
    })
  })
})
