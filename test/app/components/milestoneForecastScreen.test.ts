import { describe, expect, test } from 'vitest'
import { INPUT_LABELS } from '../../../src/app/inputsScreen.js'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import { submitInputs, TEAM } from '../../forecast/forecastingForTest.js'
import { newTeam } from '../../forecast/forecastViewScenario.js'
import { all, allByRole, byRole, hasRole, one, render, text } from '../dom.js'
import { drawn, forecast, dateSaid, headline, entered, onTypedCounts } from './milestoneForecastScreenScenario.js'

// The Milestone forecast screen (#236), rendered from the views Seam B gives (test/forecast/forecastingForTest.ts),
// started no server: empty, problems to fix, and the forecast with its headline, dates and warnings; the finish graph,
// pace and capacity have files beside this one. Shared arrangement is milestoneForecastScreenScenario.ts's. What each
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
    const view = await team.milestoneForecastView()
    if (view.kind !== 'problems') throw new Error(`Expected problems, but it was ${view.kind}`)
    if (view.problems.length === 0) throw new Error('Expected problems, but the list was empty')
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe('Checkout v2 Fix this on the Inputs screen to see a forecast.')
    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe(
      view.problems.map(({ input, message }) => `⚠ ${INPUT_LABELS[input]}: ${message}`).join(' '),
    )
    expect(hasRole(page, 'region', { name: 'Forecast' })).toBe(false)
  })

  test('problems, more than one: asks for these to be fixed', async () => {
    const team = await newTeam()
    team.storage.saveMilestoneInputs({
      teamId: TEAM,
      name: 'Checkout v2',
      startDate: undefined,
      ticketsRemaining: undefined,
      ambiguity: 'medium',
      cadenceDays: 7,
      paceMode: 'range',
      paceRange: undefined,
      paceCounts: [],
      paceCadenceDays: undefined,
      paceWindow: { action: undefined, skippedPeriods: [] },
      ticketsSource: 'typed',
      seenReads: { ticketsRemaining: undefined, pace: undefined },
    })
    const view = await team.milestoneForecastView()
    if (view.kind !== 'problems' || view.problems.length < 2) throw new Error('Expected more than one problem')
    const page = drawn(view)

    expect(text(one(page, 'header'))).toBe('Checkout v2 Fix these on the Inputs screen to see a forecast.')
    expect(text(byRole(page, 'region', { name: 'What to fix' }))).toBe(
      view.problems.map(({ input, message }) => `⚠ ${INPUT_LABELS[input]}: ${message}`).join(' '),
    )
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

  test('the sidebar links each screen, the forecast’s marked current; the head carries the icon and fonts inline, loading nothing', async () => {
    const html = renderMilestoneForecastScreen(forecast(await (await entered('100', ['4', '8'])).milestoneForecastView()))
    const page = render(html)

    expect(allByRole(byRole(page, 'navigation'), 'link').map((link) => [text(link), link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
      ['Milestone forecast', '/', 'page'],
      ['Inputs', '/inputs', null],
      ['How it works', '/how-it-works', null],
    ])
    expect(one(page, 'head link[rel="icon"]').getAttribute('href')).toMatch(/^data:image\/svg\+xml,%3Csvg/)
    for (const family of ['Geist', 'Geist Mono']) {
      expect(one(page, 'head style#fonts').textContent).toContain(`font-family: '${family}'`)
    }
    expect(one(page, 'head style#fonts').textContent).toMatch(/url\(data:font\/woff2;base64,/)
    expect(html).not.toMatch(/(?:href=|src=|url\()["']?(?:https?:)?\/\//)
    expect(html).not.toContain('@import')
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
    expect(text(byRole(page, 'region', { name: 'Warnings' }))).toBe('⚠ Pace: At 0 tickets a week, the work never finishes.')
    expect(hasRole(page, 'figure')).toBe(false)
  })

  test('a warning that names its input already is not labelled again', async () => {
    const page = drawn(forecast(await (await onTypedCounts('100', '6, 4, 9, 7')).milestoneForecastView()))

    expect(text(byRole(page, 'region', { name: 'Warnings' }))).toBe('⚠ Typed counts: 4 weeks entered. The forecast needs 8 to be reliable.')
  })

  test('0 tickets remaining: the start date headlined, and no finish graph', async () => {
    const page = drawn(forecast(await (await entered('0', ['4', '8'])).milestoneForecastView()))

    expect(text(one(page, 'header'))).toBe('Checkout v2 · 0 tickets remaining Starting 1 Sep 2026: 85% confident of finishing by 1 Sep 2026')
    expect(hasRole(page, 'figure')).toBe(false)
  })

  test('every date past: each marked already past, the headline’s as a risk, and the warnings above the dates and graph', async () => {
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
    const warnings = byRole(page, 'region', { name: 'Warnings' })
    for (const below of [byRole(page, 'region', { name: 'Forecast' }), byRole(page, 'figure')]) {
      expect(warnings.compareDocumentPosition(below) & 4 /* following */).toBe(4)
    }
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
