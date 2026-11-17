import { describe, expect, test } from 'vitest'
import { startOnSavedData, page, text, post, submitPace, dateAt, submitCounts, choosePace } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts.

describe('Milestone forecast screen: pace pattern', () => {
  /** About 4 a week, then 8 for the last four weeks. */
  const STEPPED_UP = '4, 3, 5, 4, 4, 3, 4, 5, 3, 4, 8, 9, 7, 8'

  test('under the pace bars, one folded line names the pattern; opened, it says what it means and what to do, with the 85% date both ways and a button', async () => {
    await startOnSavedData()
    await submitCounts(STEPPED_UP)
    await choosePace('counts')

    const html = await page('/')

    expect(html).toMatch(/<figure class="pace-trend"[\s\S]*<details class="pace-pattern"><summary>Stepped up · about 4 a week, then 8 since 22 Sep<\/summary>/)
    const opened = text(html.slice(html.indexOf('class="pace-pattern"')))
    expect(opened).toMatch(
      /^.*About 4 a week, then 8 since 22 Sep\. If that&#39;s lasting, count pace from 22 Sep\. 85% confident by \d{1,2} [A-Z][a-z]{2} 2026 now, \d{1,2} [A-Z][a-z]{2} 2026 from 22 Sep\. Start from 22 Sep/,
    )
    expect(html).toContain(
      '<form method="post" action="/pace-action/apply"><input type="hidden" name="action" value="startFrom"><input type="hidden" name="date" value="2026-09-22"><button>Start from 22 Sep</button></form>',
    )
  })

  test('the button counts pace from the step, saying so with Undo, which brings every count back', async () => {
    await startOnSavedData()
    await submitCounts(STEPPED_UP)
    await choosePace('counts')
    const offered = text(await page('/')).match(/(\d{1,2} [A-Z][a-z]{2} 2026) from 22 Sep/)![1]!

    const applied = await post('/pace-action/apply', [
      ['action', 'startFrom'],
      ['date', '2026-09-22'],
    ])

    expect(applied.status).toBe(303)
    expect(applied.headers.get('location')).toBe('/')
    const html = await page('/')
    expect(dateAt(text(html), 85)).toBe(offered)
    expect(text(html)).toContain('Pace Change typed counts, 4 weeks')
    expect(text(html)).toContain('Counting pace from 22 Sep, after it stepped up. Undo')
    expect(html).toContain('<form class="pace-applied" method="post" action="/pace-action/undo">')

    await post('/pace-action/undo', [])

    expect(text(await page('/'))).toContain('Pace Change typed counts, 14 weeks')
  })

  test('an action leaving too few counts to forecast from shows what to fix, with the action said and Undo', async () => {
    await startOnSavedData()
    await submitCounts('4, 3, 4, 5, 4, 9, 8, 9')
    await choosePace('counts')
    const date = (await page('/')).match(/name="date" value="(\d{4}-\d{2}-\d{2})"/)![1]!

    await post('/pace-action/apply', [
      ['action', 'startFrom'],
      ['date', date],
    ])

    const html = await page('/')
    expect(text(html)).toMatch(/Typed counts: Counting pace from \d{1,2} [A-Z][a-z]{2} leaves 3 weeks\. The forecast needs at least 4\./)
    expect(text(html)).toMatch(/Counting pace from \d{1,2} [A-Z][a-z]{2}, after it stepped up\. Undo/)
    expect(html).toContain('<form class="pace-applied" method="post" action="/pace-action/undo">')
  })

  test('one odd week posts the period it leaves out, and the forecast says it is left out', async () => {
    await startOnSavedData()
    await submitCounts('5, 6, 5, 4, 6, 5, 5, 4, 6, 5, 23, 5, 6, 4')
    await choosePace('counts')
    const period = (await page('/')).match(
      /<input type="hidden" name="action" value="leaveOut"><input type="hidden" name="period" value="(\d{4}-\d{2}-\d{2})">/,
    )![1]!

    await post('/pace-action/apply', [
      ['action', 'leaveOut'],
      ['period', period],
    ])

    expect(text(await page('/'))).toMatch(/Leaving out the week of \d{1,2} [A-Z][a-z]{2}, the odd week\. Undo/)
  })

  test('with too few weeks to read, the line says so, faintly, and opens to nothing', async () => {
    await startOnSavedData()
    await submitCounts('5, 4, 6, 5, 5')
    await choosePace('counts')

    expect(await page('/')).toContain('<p class="pace-pattern quiet">No pattern yet · 5 weeks is too few to tell</p>')
  })

  test('with the pace as a range, there is no pattern line', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    expect(await page('/')).not.toContain('class="pace-pattern')
  })
})
