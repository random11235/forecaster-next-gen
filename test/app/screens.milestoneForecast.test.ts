import { assert, describe, expect, test } from 'vitest'
import {
  CHECKOUT,
  stored,
  startOnSavedData,
  startWithNoMilestone,
  page,
  text,
  submitMilestone,
  submitPace,
  submitCadence,
  dateAt,
  submitCounts,
  choosePace,
} from './screensHarness.js'
import { found } from './found.js'

// The screens through the local server: see screensHarness.ts.

describe('Milestone forecast screen', () => {
  test('with nothing entered, points the EM to the Inputs screen', async () => {
    await startWithNoMilestone()

    const html = await page('/')

    expect(text(html)).toContain('No milestone defined yet.')
    expect(html).toMatch(/on the <a href="\/inputs">Inputs screen<\/a>/)
  })

  test('before pace is entered, lists what to fix on the Inputs screen, naming the input', async () => {
    await startOnSavedData()

    const html = await page('/')

    expect(text(html)).toContain('Fix this on the Inputs screen to see a forecast.')
    expect(text(html)).toContain('Pace: Enter a pace range.')
    expect(html).toContain('href="/inputs"')
  })

  test('with more than one thing to fix, asks for them all to be fixed', async () => {
    await startOnSavedData()
    stored().saveMilestoneInputs({ ...CHECKOUT, ticketsRemaining: undefined })

    const screen = text(await page('/'))

    expect(screen).toContain('Fix these on the Inputs screen to see a forecast.')
    expect(screen).toContain('Tickets remaining: Enter how many tickets are left.')
    expect(screen).toContain('Pace: Enter a pace range.')
  })

  test('headlines the 85% date from the start date, with the name and tickets remaining above it', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('Checkout v2 · 40 tickets remaining')
    expect(screen).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('shows the finish dates at 50%, 70%, 85% and 95% and the pace range they come from', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('50% confident by 10 Nov 2026')
    expect(screen).toContain('70% confident by 24 Nov 2026')
    expect(screen).toContain('85% confident by 1 Dec 2026')
    expect(screen).toContain('95% confident by 8 Dec 2026')
    expect(screen).toContain('Pace Change 4–8 tickets per week (range)')
  })

  test('at a 14-day cadence, says the pace is per sprint, and forecasts later than the same pace per week', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    const weekly = dateAt(text(await page('/')), 85)

    await submitCadence('14')

    const screen = text(await page('/'))
    expect(screen).toContain('Pace Change 4–8 tickets per sprint (range)')
    expect(screen).toContain('Pace: cadence length has changed. Please verify that the per period numbers are aligned.')
    expect(screen).not.toContain('tickets per week')
    expect(Date.parse(dateAt(screen, 85))).toBeGreaterThan(Date.parse(weekly))
  })

  test('states the typed counts the forecast used, in weeks', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9, 7, 5, 8')

    await choosePace('counts')

    expect(text(await page('/'))).toContain('Pace Change typed counts, 6 weeks')
  })

  test('at a 14-day cadence, states the typed counts the forecast used in sprints', async () => {
    await startOnSavedData()
    await submitCadence('14')
    await submitCounts('6, 4, 9, 7, 5, 8')

    await choosePace('counts')

    const screen = text(await page('/'))
    expect(screen).toContain('Pace Change typed counts, 6 sprints')
    expect(screen).not.toContain('week')
  })

  test('with 4 typed counts in use, warns on the forecast exactly that it needs 8 to be reliable, named by the typed counts', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9, 7')

    await choosePace('counts')

    const screen = text(await page('/'))
    expect(screen).toContain('confident')
    expect(screen).toContain('⚠ Typed counts: 4 weeks entered. The forecast needs 8 to be reliable.')
    expect(screen).not.toContain('Pace: Typed counts')
  })

  test('with 8 typed counts in use, gives no warning about the typed counts', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9, 7, 5, 8, 6, 7')

    await choosePace('counts')

    expect(text(await page('/'))).not.toContain('reliable')
    expect(text(await page('/inputs'))).not.toContain('needed for reliable results')
  })

  test('with 3 typed counts in use, shows no forecast, saying exactly why and pointing to the Inputs screen', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    await choosePace('counts')

    const html = await page('/')
    expect(text(html)).toContain('Typed counts: 3 weeks entered. The forecast needs at least 4. Add another count, or switch pace to the range.')
    expect(text(html)).not.toContain('confident')
    expect(html).toContain('href="/inputs"')
  })

  test('headlines an 85% date beyond the horizon as not confident by the horizon date, and each date as later than it', async () => {
    await startOnSavedData()
    await submitPace('0', '0')

    const screen = text(await page('/'))

    expect(screen).toContain('Starting 1 Sep 2026: not 85% confident of finishing by 28 Aug 2029')
    for (const percent of [50, 70, 85, 95]) expect(screen).toContain(`${percent}% confident: later than 28 Aug 2029`)
    expect(screen).toContain('Pace: At 0 tickets a week, the work never finishes.')
  })

  test('graphs when the simulations finish, a bar per week, marking the 50%, 70%, 85% and 95% dates and stressing the 85% one', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const html = await page('/')
    const graph = found(html, /<figure class="finish-graph"[\s\S]*?<\/figure>/)

    expect(graph).toContain('aria-label="When the simulations finish, by week"')
    expect(graph.match(/class="bar[ "]/g)?.length).toBeGreaterThan(10)
    expect(text(graph)).toContain('50% 10 Nov 2026')
    expect(text(graph)).toContain('70% 24 Nov 2026')
    expect(text(graph)).toContain('95% 8 Dec 2026')
    expect(graph).toMatch(/<span class="mark headline">85% <span class="date">1 Dec 2026<\/span><\/span>/)
    expect(graph.match(/class="mark headline"/g)).toHaveLength(1)
  })

  test('labels each date of the finish graph once, combining the percents that share it, the 85% one stressed', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-09-01', '2')
    await submitPace('4', '8')

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)

    expect(graph.match(/class="marker[ "]/g)).toHaveLength(1)
    expect(graph).toMatch(/<span class="mark headline">50% · 70% · 85% · 95% <span class="date">8 Sep 2026<\/span><\/span>/)
  })

  test.each([
    ['4', '8'],
    ['1', '8'],
    ['6', '7'],
  ])("at a pace of %s–%s, runs no marker's label across the line of a marker above it", async (low, high) => {
    await startOnSavedData()
    await submitPace(low, high)

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)
    const markers = [...graph.matchAll(/<div class="marker([^"]*)" style="left: ([\d.]+)%; top: (\d+)px"/g)].map(([, classes, left, top]) => ({
      runsLeft: (classes ?? '').split(' ').includes('end'),
      left: Number(left),
      top: Number(top),
    }))

    expect(markers.length).toBeGreaterThan(1)
    for (const marker of markers) {
      for (const above of markers.filter(({ top }) => top < marker.top)) {
        // a label runs away from the lines that come down through its row
        if (marker.runsLeft) expect(above.left).toBeGreaterThan(marker.left)
        else expect(above.left).toBeLessThan(marker.left)
      }
    }
  })

  test('each bar of the finish graph shows its date, the chance of completing by the end of its week and the share of simulations completed within it, on hover or keyboard focus', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)
    const bar = found(graph, /<div class="bar[^"]*"[^>]*data-date="2026-12-01"[\s\S]*?<\/div>/)

    expect(bar).toContain('tabindex="0"')
    expect(text(bar)).toContain('1 Dec 2026: 92% chance of completing by the end of this week, 12% of simulations are completed within.')
  })

  test('a bar holding fewer than 1 in 200 simulations says under 1%, not 0%', async () => {
    await startOnSavedData()
    await submitPace('1', '8')

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)
    // the earliest finish: the first bar holding any simulations
    const first = graph.match(/<div class="bar[^"]*"[^>]*data-share="(?!0")[^"]*"[\s\S]*?<\/div>/)?.[0]
    assert(first, 'the finish graph has bars')

    expect(text(first)).toContain('under 1% of simulations are completed within.')
  })

  test('ends the finish graph at the 99% date, saying under it what share of simulations finish later, and when the last does', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-09-01', '30')
    await submitCounts('0 1 1 2 8 12')
    await choosePace('counts')

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)

    expect(text(graph)).toContain('1 Sep 2026 3 Aug 2027')
    expect(text(graph)).toContain('1% of simulations finish later, the last by 8 Aug 2028.')
  })

  test('with some simulations finishing beyond the horizon, says under the graph that some are later than it', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-09-01', '30')
    await submitCounts('0 0 0 1 1 2 8 12')
    await choosePace('counts')

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)

    expect(text(graph)).toContain('1% of simulations finish later, some later than the horizon.')
  })

  test('with every simulation finishing by the last bar, says nothing of later finishes', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-09-01', '2')
    await submitPace('4', '8')

    expect(text(await page('/'))).not.toContain('finish later')
  })

  test('at a 14-day cadence, graphs when the simulations finish by sprint', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    await submitCadence('14')

    const graph = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)

    expect(text(await page('/'))).toContain('Sprint by sprint')
    expect(graph).toContain('aria-label="When the simulations finish, by sprint"')
    expect(text(graph)).toContain('Share of simulations finishing each sprint')
    expect(text(graph)).toMatch(/\d+% chance of completing by the end of this sprint, \d+% of simulations are completed within\./)
  })

  test('draws no graph when no trial finishes, nor before there is a forecast', async () => {
    await startOnSavedData()

    expect(await page('/')).not.toContain('<figure class="finish-graph"')

    await submitPace('0', '0')

    expect(await page('/')).not.toContain('<figure class="finish-graph"')
  })

  test('with 0 tickets remaining, headlines the start date and draws no graph, as every trial finishes on it', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-12-01', '0')
    await submitPace('4', '8')

    const html = await page('/')

    expect(text(html)).toContain('Starting 1 Dec 2026: 85% confident of finishing by 1 Dec 2026')
    expect(html).not.toContain('<figure class="finish-graph"')
  })

  test('states a past start date once, and marks finish dates before today as already past', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-03-02', '40')
    await submitPace('4', '8')

    const screen = text(await page('/'))

    expect(screen).toContain('⚠ Start date is 236 days before today; tickets remaining are still today&#39;s count.')
    expect(screen).not.toContain('Start date: Start date')
    expect(screen).toMatch(/Starting 2 Mar 2026: 85% confident of finishing by \d{1,2} [A-Z][a-z]{2} 2026 \(already past\)/)
    for (const percent of [50, 70, 85, 95]) {
      expect(screen).toMatch(new RegExp(`${percent}% confident by \\d{1,2} [A-Z][a-z]{2} 2026 \\(already past\\)`))
    }
  })

  test('puts the warnings straight under the headline, above the dates and the graph', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-03-02', '40')
    await submitCounts('6, 4, 9, 7')
    await choosePace('counts')

    const screen = text(await page('/'))

    const warnings = [screen.indexOf('⚠ Start date is'), screen.indexOf('⚠ Typed counts: 4 weeks entered.')]
    for (const at of warnings) {
      expect(at).toBeGreaterThan(screen.indexOf('85% confident of finishing by'))
      expect(at).toBeLessThan(screen.indexOf('When it could finish'))
      expect(at).toBeLessThan(screen.indexOf('Week by week'))
    }
  })

  test('does not mark finish dates on or after today', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    expect(text(await page('/'))).not.toContain('already past')
  })

  test('shows no epics, no committed date, and no input but the capacity sentence', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const html = await page('/')

    expect(html.replace(/<details class="capacity"[\s\S]*?<\/details>/, '')).not.toMatch(/<input|<table/)
    expect(text(html).toLowerCase()).not.toMatch(/committed|absence/)
  })
})
