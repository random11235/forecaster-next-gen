import { describe, expect, test } from 'vitest'
import { submitInputs } from '../../forecast/forecastingForTest.js'
import { outcomeOf } from '../../forecast/forecastViewScenario.js'
import { ODD_WEEK, STEPPED_UP, withTypedCounts } from '../../forecast/pacePatternScenario.js'
import { accessibleName, all, around, byRole, hiddenFields, one, postsTo, text } from '../dom.js'
import { drawn, forecast, dateSaid, problems, whatToFix } from './milestoneForecastScreenHarness.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: the pace trend and pattern, with its action, a refusal and Undo. Shared arrangement is
// milestoneForecastScreenHarness.ts's. What each view holds is Seam B's (test/forecast/milestoneForecastView*.test.ts,
// capacity*.test.ts, newUsual.test.ts, pacePattern.*.test.ts).

describe('the Milestone forecast screen: the pace pattern', () => {
  test('typed counts: their trend beside the pace, and the pattern they show, its action and its dates both ways', async () => {
    const view = forecast(await (await withTypedCounts(STEPPED_UP)).milestoneForecastView())
    const { line, action } = view.pacePattern ?? { line: '' }
    if (action?.kind !== 'startFrom') throw new Error('Expected the pattern to offer to start from a date')
    const pace = byRole(drawn(view), 'complementary', { name: 'Pace' })

    expect(accessibleName(byRole(pace, 'img'))).toMatch(new RegExp(`^Pace trend: typed counts of ${STEPPED_UP.join(', ')}, oldest first`))
    const pattern = around(byRole(pace, 'button', { name: line }), 'details')
    expect(pattern.hasAttribute('open')).toBe(false)
    pattern.setAttribute('open', '')
    expect(text(pattern)).toContain(`${view.pacePattern?.meaning} ${view.pacePattern?.advice}`)
    expect(text(pattern)).toContain(`${action.dates.percent}% confident by ${dateSaid(action.dates.now)} now, ${dateSaid(action.dates.applied)} from `)
    const apply = around(byRole(pattern, 'button', { name: action.button }), 'form')
    expect(apply.getAttribute('action')).toBe('/pace-action/apply')
    expect(hiddenFields(apply)).toEqual([
      ['action', action.kind],
      ['date', action.date],
    ])
  })

  test('leaving out the odd week: the week posted with the action', async () => {
    const view = forecast(await (await withTypedCounts(ODD_WEEK)).milestoneForecastView())
    const action = view.pacePattern?.action
    if (action?.kind !== 'leaveOut') throw new Error('Expected the pattern to offer to leave out a week')
    const pattern = around(byRole(drawn(view), 'button', { name: view.pacePattern?.line ?? '' }), 'details')
    pattern.setAttribute('open', '')
    const apply = around(byRole(pattern, 'button', { name: action.button }), 'form')

    expect(apply.getAttribute('action')).toBe('/pace-action/apply')
    expect(hiddenFields(apply)).toEqual([
      ['action', 'leaveOut'],
      ['period', action.period],
    ])
  })

  test('an action refused: the pattern open, why beside it', async () => {
    const team = await withTypedCounts(STEPPED_UP)
    const { view } = outcomeOf(await submitInputs(team, { kind: 'applyPaceAction', action: 'skipAll', date: '2026-10-12' }), 'refusedOnForecast')
    const pattern = one(drawn(view), 'details.pace-pattern')

    expect(pattern.hasAttribute('open')).toBe(true)
    expect(text(byRole(pattern, 'alert'))).toBe('That action is no longer offered.')
  })

  test('an action refused with no pattern to show it on: why, still', async () => {
    const team = await withTypedCounts(STEPPED_UP)
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '6' })
    await submitInputs(team, { kind: 'setPaceMode', paceMode: 'range' })
    const { view } = outcomeOf(await submitInputs(team, { kind: 'applyPaceAction', action: 'startFrom', date: 'soon' }), 'refusedOnForecast')

    expect(text(byRole(drawn(view), 'alert'))).toBe('That action is no longer offered.')
  })

  test('applied, leaving too few counts: the problem, the action said, and Undo', async () => {
    const team = await withTypedCounts([4, 3, 4, 5, 4, 9, 8, 9])
    await submitInputs(team, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-19' })
    const view = problems(await team.milestoneForecastView())
    if (view.paceApplied === undefined) throw new Error('Expected problems with the action applied')
    const page = drawn(view)

    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe(whatToFix(view))
    expect(text(around(byRole(page, 'button', { name: 'Undo' }), 'form'))).toBe(`${view.paceApplied} Undo`)
    expect(postsTo(byRole(page, 'button', { name: 'Undo' }))).toBe('/pace-action/undo')
  })

  test('the pattern’s action applied: said, with Undo', async () => {
    const team = await withTypedCounts(STEPPED_UP)
    await submitInputs(team, { kind: 'applyPaceAction', action: 'startFrom', date: '2026-10-12' })
    const view = forecast(await team.milestoneForecastView())
    const pace = byRole(drawn(view), 'complementary', { name: 'Pace' })

    expect(view.pacePattern?.applied).toBeDefined()
    // with no pattern left to name, its line is said plainly, not folded
    expect(text(one(pace, 'p.pace-pattern.quiet'))).toBe(view.pacePattern?.line)
    expect(all(pace, 'details.pace-pattern')).toEqual([])
    expect(text(pace)).toContain(`${view.pacePattern?.applied} Undo`)
    expect(postsTo(byRole(pace, 'button', { name: 'Undo' }))).toBe('/pace-action/undo')
    expect(accessibleName(byRole(pace, 'img'))).toMatch(new RegExp(`^Pace trend: typed counts of ${view.paceTrend?.counts.join(', ')}, oldest first`))
  })
})
