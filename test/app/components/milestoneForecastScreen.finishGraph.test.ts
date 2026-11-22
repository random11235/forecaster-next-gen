import { describe, expect, test } from 'vitest'
import { mediumGrowth, submitInputs } from '../../forecast/forecastingForTest.js'
import { newTeam } from '../../forecast/forecastViewScenario.js'
import { all, byRole, one, text } from '../dom.js'
import { drawn, forecast, dateSaid, headline, entered, onTypedCounts, finishGraph } from './milestoneForecastScreenScenario.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: its finish graph: markers, bars and the note on later finishes. Shared arrangement is
// milestoneForecastScreenScenario.ts's. What each view holds is Seam B's (test/forecast/milestoneForecastView*.test.ts,
// capacity*.test.ts, newUsual.test.ts, pacePattern.*.test.ts).

describe('the Milestone forecast screen: the finish graph', () => {
  test('every percent on one date: one marker, its percents together, stressed', async () => {
    const view = forecast(await (await entered('2', ['4', '8'])).milestoneForecastView())
    const first = view.dates[0]?.date ?? null
    if (!view.dates.every(({ date }) => date === first)) throw new Error('Expected every percent on one date')

    expect(all(finishGraph(view), '.marker').map((marker) => [text(marker), marker.classList.contains('headline')])).toEqual([
      [`50% · 70% · 85% · 95% ${dateSaid(first)}`, true],
    ])
  })

  test.each([
    ['4', '8'],
    ['1', '8'],
    ['6', '7'],
  ])('at a pace of %s–%s, no marker’s label runs across the line of a marker above it', async (low, high) => {
    const view = forecast(await (await entered('40', [low, high])).milestoneForecastView())
    const markers = all(finishGraph(view), '.marker').map((marker) => {
      const [, left, top] = /left: ([\d.]+)%; top: (\d+)px/.exec(marker.getAttribute('style') ?? '') ?? []
      return { runsLeft: marker.classList.contains('end'), left: Number(left), top: Number(top) }
    })

    expect(markers.length).toBeGreaterThan(1)
    for (const marker of markers) {
      for (const above of markers.filter(({ top }) => top < marker.top)) {
        // a label runs away from the lines that come down through its row
        if (marker.runsLeft) expect(above.left).toBeGreaterThan(marker.left)
        else expect(above.left).toBeLessThan(marker.left)
      }
    }
  })

  test('a bar’s hover text: its date, the chance of completing by the end of its week, and the share completed within it', async () => {
    const team = await newTeam()
    mediumGrowth(team, { low: 1, high: 1 })
    // 10 tickets at exactly 5 a week: every simulation finishes in the second week
    const view = forecast(await (await entered('10', ['5', '5'], { team: Promise.resolve(team) })).milestoneForecastView())
    const graph = finishGraph(view)

    expect(text(one(graph, '.bar[data-date="2026-09-15"] .tip'))).toBe(
      '15 Sep 2026: 100% chance of completing by the end of this week, 100% of simulations are completed within.',
    )
    expect(text(graph)).not.toContain('finish later')
  })

  test('a bar holding fewer than 1 in 200 simulations says under 1%, not 0%', async () => {
    const view = forecast(await (await entered('40', ['1', '8'])).milestoneForecastView())
    const first = view.finishGraph.bars.find(({ share }) => share > 0)
    if (!first || first.share >= 0.005) throw new Error('Expected a first finish holding under 1 in 200 simulations')

    expect(text(one(finishGraph(view), `.bar[data-date="${first.date}"] .tip`))).toContain(', under 1% of simulations are completed within.')
  })

  test.each([
    ['the last by its date', '0 1 1 2 8 12', '1% of simulations finish later, the last by 8 Aug 2028.'],
    ['some beyond the horizon', '0 0 0 1 1 2 8 12', '1% of simulations finish later, some later than the horizon.'],
  ])('ending at the 99%% date, it says under the graph what share finish later: %s', async (_, counts, later) => {
    const graph = finishGraph(forecast(await (await onTypedCounts('30', counts)).milestoneForecastView()))

    expect(text(one(graph, '.note.quiet'))).toBe(later)
  })

  test('under 1 in 200 simulations finishing later: says under 1%, starting the sentence', async () => {
    const view = forecast(await (await entered('40', ['4', '8'])).milestoneForecastView())
    if ((view.finishGraph.later?.share ?? 1) >= 0.005) throw new Error('Expected under 1 in 200 simulations to finish later')

    expect(text(one(finishGraph(view), '.note.quiet'))).toMatch(/^Under 1% of simulations finish later, the last by \d{1,2} [A-Z][a-z]{2} \d{4}\.$/)
  })

  test('at a 14-day cadence, the finish graph by sprint', async () => {
    const team = await entered('100', ['4', '8'])
    await submitInputs(team, { kind: 'setCadence', cadenceDays: '14' })
    const page = drawn(forecast(await team.milestoneForecastView()))
    const graph = byRole(page, 'figure', { name: 'When the simulations finish, by sprint' })

    expect(text(byRole(byRole(page, 'region', { name: 'Finish graph' }), 'heading'))).toBe('Sprint by sprint')
    expect(text(one(graph, 'figcaption'))).toMatch(/^Share of simulations finishing each sprint, from the start date\./)
    expect(text(one(graph, '.bar .tip'))).toMatch(/ chance of completing by the end of this sprint, /)
  })
})
