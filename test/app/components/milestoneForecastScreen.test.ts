import { describe, expect, test } from 'vitest'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import type { MilestoneForecastView } from '../../../src/forecast/index.js'
import { add, tenTicketsAtFive } from '../../forecast/capacityScenario.js'
import { submitInputs } from '../../forecast/forecastingForTest.js'
import { newTeam } from '../../forecast/forecastViewScenario.js'
import { withTypedCounts } from '../../forecast/pacePatternScenario.js'
import { accessibleName, allByRole, around, byRole, hasRole, one, render, text } from '../dom.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: empty, problems to fix, the forecast with its warnings, finish graph and pace, the pace trend and
// pattern with its action and Undo, capacity in use, and a form refused there. What each view holds is Seam B's
// (test/forecast/milestoneForecastView*.test.ts, capacity*.test.ts, pacePattern.*.test.ts).

const drawn = (view: MilestoneForecastView) => render(renderMilestoneForecastScreen(view))
const STEPPED_UP = [4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8]

describe('the Milestone forecast screen', () => {
  test('empty: says no milestone is defined yet, with a link to the Inputs screen, and nothing else', async () => {
    const page = drawn(await (await newTeam()).milestoneForecastView())

    expect(text(byRole(page, 'heading'))).toBe('No milestone defined yet.')
    expect(byRole(page, 'link', { name: 'Inputs screen' }).getAttribute('href')).toBe('/inputs')
    expect(hasRole(page, 'region')).toBe(false)
  })

  test('problems: the milestone named, what to fix, each beside its input’s label', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '100' })
    const page = drawn(await team.milestoneForecastView())

    expect(text(one(page, 'header'))).toBe('Checkout v2 Fix this on the Inputs screen to see a forecast.')
    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe('⚠ Pace: Enter a pace range.')
    expect(hasRole(page, 'region', { name: 'Forecast' })).toBe(false)
  })

  test('a forecast: the 85% headline, each date, the finish graph with its markers, and the pace beside them', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '100' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    const page = drawn(await team.milestoneForecastView())

    expect(text(one(page, 'header'))).toBe('Checkout v2 · 100 tickets remaining Starting 1 Sep 2026: 85% confident of finishing by 6 Apr 2027')
    expect(page.querySelector('h1 .good')).not.toBeNull()
    const forecast = byRole(page, 'region', { name: 'Forecast' })
    expect(allByRole(forecast, 'listitem').map((date) => text(date))).toEqual([
      '50% confident by 2 Mar 2027',
      '70% confident by 23 Mar 2027',
      '85% confident by 6 Apr 2027',
      '95% confident by 20 Apr 2027',
    ])
    expect(text(forecast)).toContain('Ambiguity: medium, growing 1–2×')
    const graph = byRole(page, 'figure', { name: 'When the simulations finish, by week' })
    expect(text(one(graph, 'figcaption'))).toBe('Share of simulations finishing each week, from the start date. The 85% date is the headline.')
    expect([...graph.querySelectorAll('.marker')].map((marker) => [text(marker), marker.classList.contains('headline')])).toEqual([
      ['95% 20 Apr 2027', false],
      ['85% 6 Apr 2027', true],
      ['70% 23 Mar 2027', false],
      ['50% 2 Mar 2027', false],
    ])
    const pace = byRole(page, 'complementary', { name: 'Pace' })
    expect(byRole(pace, 'link', { name: 'Change' }).getAttribute('href')).toBe('/inputs#pace')
    expect(text(byRole(pace, 'button', { name: /^Capacity/ }))).toBe('Capacity none, every week usual')
    expect(hasRole(page, 'region', { name: 'Warnings' })).toBe(false)
  })

  test('a start date past: warned, and the dates still to come', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-08-01', ticketsRemaining: '100' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    const page = drawn(await team.milestoneForecastView())

    expect(text(byRole(page, 'region', { name: 'Warnings' }))).toBe("⚠ Start date is 23 days before today; tickets remaining are still today's count.")
  })

  test('typed counts: their trend beside the pace, and the pattern they show, its action and its dates both ways', async () => {
    const pace = byRole(drawn(await (await withTypedCounts(STEPPED_UP)).milestoneForecastView()), 'complementary', { name: 'Pace' })

    expect(accessibleName(byRole(pace, 'img'))).toMatch(/^Pace trend: typed counts of 4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8, oldest first/)
    const pattern = around(byRole(pace, 'button', { name: 'Stepped up · about 4 a week, then 8 since 12 Oct' }), 'details')
    expect(pattern.hasAttribute('open')).toBe(false)
    pattern.setAttribute('open', '')
    expect(text(pattern)).toMatch(/85% confident by \d+ \w+ \d{4} now, \d+ \w+ \d{4} from 12 Oct\./)
    const apply = around(byRole(pattern, 'button', { name: 'Start from 12 Oct' }), 'form')
    expect(apply.getAttribute('action')).toBe('/pace-action/apply')
    expect([...apply.querySelectorAll('input[type="hidden"]')].map((field) => [field.getAttribute('name'), field.getAttribute('value')])).toEqual([
      ['action', 'startFrom'],
      ['date', '2026-10-12'],
    ])
  })

  test('the pattern’s action applied: said, with Undo', async () => {
    const team = await withTypedCounts(STEPPED_UP)
    await submitInputs(team, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })
    const pace = byRole(drawn(await team.milestoneForecastView()), 'complementary', { name: 'Pace' })

    expect(byRole(pace, 'button', { name: 'Undo' }).closest('form')?.getAttribute('action')).toBe('/pace-action/undo')
    expect(accessibleName(byRole(pace, 'img'))).toMatch(/^Pace trend: typed counts of 8, 9, 7, 8, oldest first/)
  })

  test('capacity in use: each date with and at usual capacity, how far it moves, the shaded week, and its entry', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '50', '2026-09-07', '2026-09-13')
    const page = drawn(await team.milestoneForecastView({ capacityOpen: true }))

    expect(text(one(page, 'header'))).toBe(
      'Launch · 10 tickets remaining Starting 7 Sep 2026: 85% confident of finishing by 28 Sep 2026 Includes capacity, which moves the 85% date 1 week later.',
    )
    expect(allByRole(byRole(page, 'table'), 'row').map((row) => text(row))).toEqual([
      'With capacity At usual capacity',
      '50% confident by 28 Sep 2026 21 Sep 2026 1 week later',
      '85% confident by 28 Sep 2026 21 Sep 2026 1 week later',
      '95% confident by 28 Sep 2026 21 Sep 2026 1 week later',
    ])
    expect(text(byRole(page, 'figure')).match(/Shaded weeks: capacity changes, at the % shown\./)).not.toBeNull()
    expect(text(one(page, '.bar.changed .capacity'))).toBe('50%')
    const capacity = one(page, '#capacity')
    expect(capacity.hasAttribute('open')).toBe(true)
    expect(byRole(capacity, 'switch', { name: 'Use capacity in this forecast' }).getAttribute('aria-checked')).toBe('true')
    expect(byRole(capacity, 'button', { name: 'Remove' }).closest('form')?.getAttribute('action')).toMatch(/^\/capacity\/remove/)
  })

  test('a capacity refused there: the screen again, capacity open, why beside the sentence typed', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    const outcome = await add(team, '5000', '2026-09-07', '')
    if (outcome.kind !== 'refusedOnForecast') throw new Error(`Expected refused on the forecast, but it was ${outcome.kind}`)
    const capacity = one(drawn(outcome.view), '#capacity')

    expect(capacity.hasAttribute('open')).toBe(true)
    expect(text(byRole(capacity, 'alert'))).toBe('Capacity above 1000% can’t be forecast. For a team that much bigger, use a pace range.')
    expect(byRole(capacity, 'spinbutton', { name: 'Capacity, in % of usual' }).getAttribute('value')).toBe('5000')
  })
})
