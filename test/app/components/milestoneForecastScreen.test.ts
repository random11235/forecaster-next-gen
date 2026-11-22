import { describe, expect, test } from 'vitest'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import type { MilestoneForecastView } from '../../../src/forecast/index.js'
import { add, tenTicketsAtFive } from '../../forecast/capacityScenario.js'
import { submitInputs } from '../../forecast/forecastingForTest.js'
import { newTeam } from '../../forecast/forecastViewScenario.js'
import { withTypedCounts } from '../../forecast/pacePatternScenario.js'
import { accessibleName, all, allByRole, around, byRole, hasRole, one, postsTo, render, text } from '../dom.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: empty, problems to fix, the forecast with its warnings, finish graph and pace, the pace trend and
// pattern with its action and Undo, capacity in use, and a form refused there. What each view holds is Seam B's
// (test/forecast/milestoneForecastView*.test.ts, capacity*.test.ts, pacePattern.*.test.ts).

const drawn = (view: MilestoneForecastView) => render(renderMilestoneForecastScreen(view))
/** `view`, a forecast, failing if it is not. */
function forecast(view: MilestoneForecastView): Extract<MilestoneForecastView, { kind: 'forecast' }> {
  if (view.kind !== 'forecast') throw new Error(`Expected a forecast, but it was ${view.kind}`)
  return view
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** A date the view gives, as the screens say it: `2027-04-06` → `6 Apr 2027`. */
function said(isoDate: string | null): string {
  if (isoDate === null) throw new Error('Expected a date, but it was later than the horizon')
  const [year, month, day] = isoDate.split('-')
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`
}
/** The date `view` gives at its headline's percent, as the screens say it. */
const headline = (view: Extract<MilestoneForecastView, { kind: 'forecast' }>) =>
  said(view.dates.find(({ percent }) => percent === view.headlinePercent)?.date ?? null)
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
    const view = await team.milestoneForecastView()
    if (view.kind !== 'problems') throw new Error(`Expected problems, but it was ${view.kind}`)
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe('Checkout v2 Fix this on the Inputs screen to see a forecast.')
    expect(view.problems.map(({ input }) => input)).toEqual(['pace'])
    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe(`⚠ Pace: ${view.problems[0]?.message}`)
    expect(hasRole(page, 'region', { name: 'Forecast' })).toBe(false)
  })

  test('a forecast: the 85% headline, each date, the finish graph with its markers, and the pace beside them', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '100' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    const view = forecast(await team.milestoneForecastView())
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe(`Checkout v2 · 100 tickets remaining Starting 1 Sep 2026: 85% confident of finishing by ${headline(view)}`)
    // the headline's date, still to come, stressed as good news
    expect(text(one(page, 'h1 .good'))).toBe(headline(view))
    const dates = byRole(page, 'region', { name: 'Forecast' })
    expect(allByRole(dates, 'listitem').map((date) => text(date))).toEqual(view.dates.map(({ percent, date }) => `${percent}% confident by ${said(date)}`))
    expect(text(dates)).toContain(`Ambiguity: medium, growing ${view.ambiguity.low}–${view.ambiguity.high}×`)
    const graph = byRole(page, 'figure', { name: 'When the simulations finish, by week' })
    expect(text(one(graph, 'figcaption'))).toBe('Share of simulations finishing each week, from the start date. The 85% date is the headline.')
    // a marker for each date, latest first, the headline's stressed: the view's four dates are each their own
    expect(all(graph, '.marker').map((marker) => [text(marker), marker.classList.contains('headline')])).toEqual(
      view.dates.map(({ percent, date }) => [`${percent}% ${said(date)}`, percent === view.headlinePercent]).reverse(),
    )
    const pace = byRole(page, 'complementary', { name: 'Pace' })
    expect(byRole(pace, 'link', { name: 'Change' }).getAttribute('href')).toBe('/inputs#pace')
    expect(text(byRole(pace, 'button', { name: /^Capacity/ }))).toBe('Capacity none, every week usual')
    expect(hasRole(page, 'region', { name: 'Warnings' })).toBe(false)
  })

  test('a start date past: warned, and the dates still to come', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-08-01', ticketsRemaining: '100' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    const view = forecast(await team.milestoneForecastView())

    expect(view.warnings.map(({ input }) => input)).toEqual(['startDate'])
    expect(text(byRole(drawn(view), 'region', { name: 'Warnings' }))).toBe(`⚠ ${view.warnings[0]?.message}`)
  })

  test('typed counts: their trend beside the pace, and the pattern they show, its action and its dates both ways', async () => {
    const view = forecast(await (await withTypedCounts(STEPPED_UP)).milestoneForecastView())
    const { line, action } = view.pacePattern ?? { line: '' }
    if (action?.kind !== 'startFrom') throw new Error('Expected the pattern to offer to start from a date')
    const pace = byRole(drawn(view), 'complementary', { name: 'Pace' })

    expect(accessibleName(byRole(pace, 'img'))).toMatch(new RegExp(`^Pace trend: typed counts of ${STEPPED_UP.join(', ')}, oldest first`))
    const pattern = around(byRole(pace, 'button', { name: line }), 'details')
    expect(pattern.hasAttribute('open')).toBe(false)
    pattern.setAttribute('open', '')
    expect(text(pattern)).toContain(`${action.dates.percent}% confident by ${said(action.dates.now)} now, ${said(action.dates.applied)} from `)
    const apply = around(byRole(pattern, 'button', { name: action.button }), 'form')
    expect(apply.getAttribute('action')).toBe('/pace-action/apply')
    expect(all(apply, 'input[type="hidden"]').map((field) => [field.getAttribute('name'), field.getAttribute('value')])).toEqual([
      ['action', action.kind],
      ['date', action.date],
    ])
  })

  test('the pattern’s action applied: said, with Undo', async () => {
    const team = await withTypedCounts(STEPPED_UP)
    await submitInputs(team, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })
    const view = forecast(await team.milestoneForecastView())
    const pace = byRole(drawn(view), 'complementary', { name: 'Pace' })

    expect(view.pacePattern?.applied).toBeDefined()
    expect(text(pace)).toContain(`${view.pacePattern?.applied} Undo`)
    expect(postsTo(byRole(pace, 'button', { name: 'Undo' }))).toBe('/pace-action/undo')
    expect(accessibleName(byRole(pace, 'img'))).toMatch(new RegExp(`^Pace trend: typed counts of ${view.paceTrend?.counts.join(', ')}, oldest first`))
  })

  test('capacity in use: each date with and at usual capacity, how far it moves, the shaded week, and its entry', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    await add(team, '50', '2026-09-07', '2026-09-13')
    const view = forecast(await team.milestoneForecastView({ capacityOpen: true }))
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe(
      `Launch · 10 tickets remaining Starting 7 Sep 2026: 85% confident of finishing by ${headline(view)} ${view.capacityLine}`,
    )
    expect(allByRole(byRole(page, 'table'), 'row').map((row) => text(row))).toEqual([
      'With capacity At usual capacity',
      ...(view.comparison ?? []).map(
        ({ percent, withCapacity, atUsual, shift }) => `${percent}% confident by ${said(withCapacity)} ${said(atUsual)} ${shift.words}`,
      ),
    ])
    expect(text(byRole(page, 'figure')).match(/Shaded weeks: capacity changes, at the % shown\./)).not.toBeNull()
    expect(text(one(page, '.bar.changed .capacity'))).toBe('50%')
    const capacity = one(page, '#capacity')
    expect(capacity.hasAttribute('open')).toBe(true)
    expect(byRole(capacity, 'switch', { name: 'Use capacity in this forecast' }).getAttribute('aria-checked')).toBe('true')
    expect(postsTo(byRole(capacity, 'button', { name: 'Remove' }))).toMatch(/^\/capacity\/remove/)
  })

  test('a capacity refused there: the screen again, capacity open, why beside the sentence typed', async () => {
    const team = await newTeam()
    await tenTicketsAtFive(team)
    const outcome = await add(team, '5000', '2026-09-07', '')
    if (outcome.kind !== 'refusedOnForecast') throw new Error(`Expected refused on the forecast, but it was ${outcome.kind}`)
    const { refusal } = forecast(outcome.view).capacity
    const capacity = one(drawn(outcome.view), '#capacity')

    expect(capacity.hasAttribute('open')).toBe(true)
    expect(refusal).toBeDefined()
    expect(text(byRole(capacity, 'alert'))).toBe(refusal)
    expect(byRole(capacity, 'spinbutton', { name: 'Capacity, in % of usual' }).getAttribute('value')).toBe('5000')
  })
})
