import { describe, expect, test } from 'vitest'
import { INPUT_LABELS } from '../../../src/app/inputsScreen.js'
import { submitInputs } from '../../forecast/forecastingForTest.js'
import { keptFromBeforeTheMvp, newTeam } from '../../forecast/forecastViewScenario.js'
import { withTypedCounts } from '../../forecast/pacePatternScenario.js'
import { all, allByRole, byRole, hasRole, one, text } from '../dom.js'
import { drawn, forecast, dateSaid, headline, entered, problems, whatToFix, labelled } from './milestoneForecastScreenHarness.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: empty, problems to fix, and the forecast with its headline, dates and warnings; the finish graph,
// pace and capacity have files beside this one. Shared arrangement is milestoneForecastScreenHarness.ts's. What each
// view holds is Seam B's (test/forecast/milestoneForecastView*.test.ts, capacity*.test.ts, newUsual.test.ts,
// pacePattern.*.test.ts).

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
    const view = problems(await team.milestoneForecastView())
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe('Checkout v2 Fix this on the Inputs screen to see a forecast.')
    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe(whatToFix(view))
    expect(hasRole(page, 'region', { name: 'Forecast' })).toBe(false)
  })

  test('problems, more than one: asks for these to be fixed', async () => {
    const team = await newTeam()
    keptFromBeforeTheMvp(team)
    const view = problems(await team.milestoneForecastView())
    if (view.problems.length < 2) throw new Error('Expected more than one problem')
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe('Checkout v2 Fix these on the Inputs screen to see a forecast.')
    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe(whatToFix(view))
  })

  test('a forecast: the 85% headline, each date, the finish graph with its markers, and the pace beside them', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '100' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    const view = forecast(await team.milestoneForecastView())
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe(
      `Checkout v2 · 100 tickets remaining Starting 1 Sep 2026: ${view.headlinePercent}% confident of finishing by ${headline(view)}`,
    )
    // the headline's date, still to come, stressed as good news
    expect(text(one(page, 'h1 .good'))).toBe(headline(view))
    const dates = byRole(page, 'region', { name: 'Forecast' })
    expect(allByRole(dates, 'listitem').map((date) => text(date))).toEqual(view.dates.map(({ percent, date }) => `${percent}% confident by ${dateSaid(date)}`))
    expect(text(dates)).toContain(`Ambiguity: medium, growing ${view.ambiguity.low}–${view.ambiguity.high}×`)
    const graph = byRole(page, 'figure', { name: 'When the simulations finish, by week' })
    expect(text(one(graph, 'figcaption'))).toBe(
      `Share of simulations finishing each week, from the start date. The ${view.headlinePercent}% date is the headline.`,
    )
    // a marker for each date, latest first, the headline's stressed: the view's four dates are each their own
    expect(all(graph, '.marker').map((marker) => [text(marker), marker.classList.contains('headline')])).toEqual(
      view.dates.map(({ percent, date }) => [`${percent}% ${dateSaid(date)}`, percent === view.headlinePercent]).reverse(),
    )
    // a bar for each the view gives, each with its date, its hover text reached by keyboard too
    expect(all(graph, '.bar').map((bar) => [bar.getAttribute('data-date'), bar.getAttribute('tabindex')])).toEqual(
      view.finishGraph.bars.map(({ date }) => [date, '0']),
    )
    const pace = byRole(page, 'complementary', { name: 'Pace' })
    expect(text(pace).startsWith(`Pace Change ${view.paceSaid} Capacity`)).toBe(true)
    expect(byRole(pace, 'link', { name: 'Change' }).getAttribute('href')).toBe('/inputs#pace')
    expect(text(byRole(pace, 'button', { name: /^Capacity/ }))).toBe('Capacity none, every week usual')
    // a pace range has no pattern to name
    expect(all(page, '.pace-pattern')).toEqual([])
    expect(hasRole(page, 'region', { name: 'Warnings' })).toBe(false)
    // nothing to type but the capacity sentence, and no epics or committed date
    expect(all(page, 'input, select, textarea, table').filter((field) => !field.closest('#capacity'))).toEqual([])
    expect(text(page).toLowerCase()).not.toMatch(/committed|epic|absence/)
  })

  test('beyond the horizon: not confident by the horizon, each date later than it, the pace warned of, and no finish graph', async () => {
    const view = forecast(await (await entered('10', ['0', '0'])).milestoneForecastView())
    const page = drawn(view)
    const horizon = dateSaid(view.horizonDate)

    expect(text(one(page, 'header'))).toBe(`Checkout v2 · 10 tickets remaining Starting 1 Sep 2026: not 85% confident of finishing by ${horizon}`)
    expect(text(one(page, 'h1 .risk'))).toBe(horizon)
    expect(allByRole(byRole(page, 'region', { name: 'Forecast' }), 'listitem').map((date) => text(date))).toEqual(
      [50, 70, 85, 95].map((percent) => `${percent}% confident: later than ${horizon}`),
    )
    // a warning about an input is labelled with it
    const [warning, ...others] = view.warnings
    if (warning?.input !== 'pace' || others.length > 0) throw new Error('Expected the one warning to be about the pace')
    expect(text(byRole(page, 'region', { name: 'Warnings' }))).toBe(labelled(warning))
    expect(hasRole(page, 'figure')).toBe(false)
  })

  test('warnings: straight under the headline, above the dates and the graph, each in turn, one naming its input not labelled again', async () => {
    // a start date past, and too few typed counts to be reliable
    const view = forecast(await (await withTypedCounts([6, 4, 9, 7])).milestoneForecastView())
    if (view.warnings.map(({ input }) => input).join() !== 'startDate,typedCounts') throw new Error('Expected the start date warned of, then the typed counts')
    for (const { input, message } of view.warnings) if (!message.startsWith(INPUT_LABELS[input])) throw new Error(`Expected ${input}'s warning to name it`)
    const page = drawn(view)
    const warnings = byRole(page, 'region', { name: 'Warnings' })

    expect(all(warnings, 'p').map((warning) => text(warning))).toEqual(view.warnings.map(({ message }) => `⚠ ${message}`))
    expect(one(page, 'header').compareDocumentPosition(warnings) & 4 /* following */).toBe(4)
    for (const below of [byRole(page, 'region', { name: 'Forecast' }), byRole(page, 'figure')]) {
      expect(warnings.compareDocumentPosition(below) & 4 /* following */).toBe(4)
    }
  })

  test('0 tickets remaining: the start date headlined, and no finish graph', async () => {
    const view = forecast(await (await entered('0', ['4', '8'])).milestoneForecastView())
    if (!view.dates.every(({ date }) => date === '2026-09-01')) throw new Error('Expected every date on the start date')
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe(
      `Checkout v2 · 0 tickets remaining Starting 1 Sep 2026: ${view.headlinePercent}% confident of finishing by ${dateSaid('2026-09-01')}`,
    )
    expect(hasRole(page, 'figure')).toBe(false)
  })

  test('every date past: each marked already past, and the headline’s as a risk', async () => {
    const view = forecast(await (await entered('40', ['4', '8'], { startDate: '2026-03-02' })).milestoneForecastView())
    if (!view.dates.every(({ alreadyPast }) => alreadyPast)) throw new Error('Expected every date already past')
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe(
      `Checkout v2 · 40 tickets remaining Starting 2 Mar 2026: 85% confident of finishing by ${headline(view)} (already past)`,
    )
    expect(text(one(page, 'h1 .risk'))).toBe(headline(view))
    expect(allByRole(byRole(page, 'region', { name: 'Forecast' }), 'listitem').map((date) => text(date))).toEqual(
      view.dates.map(({ percent, date }) => `${percent}% confident by ${dateSaid(date)} (already past)`),
    )
  })

  test('a start date past: warned, and the dates still to come', async () => {
    const team = await newTeam()
    await submitInputs(team, { kind: 'setMilestone', name: 'Checkout v2', startDate: '2026-08-01', ticketsRemaining: '100' })
    await submitInputs(team, { kind: 'setPaceRange', low: '4', high: '8' })
    const view = forecast(await team.milestoneForecastView())

    if (view.warnings.length === 0) throw new Error('Expected warnings, but the list was empty')
    expect(text(byRole(drawn(view), 'region', { name: 'Warnings' }))).toBe(view.warnings.map(({ message }) => `⚠ ${message}`).join(' '))
  })
})
