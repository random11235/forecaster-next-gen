import { describe, expect, test } from 'vitest'
import { startOnSavedData, page, text, post, submitPace, dateAt, addCapacity } from './screensHarness.js'
import { found } from './found.js'

// The screens through the local server: see screensHarness.ts.

describe('Milestone forecast screen: capacity', () => {
  test('beside the forecast, under Pace, every week is at 100% until capacity is typed, as a sentence posting to its section', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const html = await page('/')

    expect(text(html)).toMatch(/Pace Change 4–8 tickets per week \(range\).*Capacity.*100% = the team’s usual week, as in the pace\. Every week is at 100%\./)
    expect(text(html)).toContain('Weekends don’t count; overlapping entries multiply. Past counts aren’t adjusted.')
    expect(html).toContain('<form method="post" action="/capacity/add?capacity=open#capacity"')
    expect(html).toContain('id="capacity"')
  })

  test('a week off, typed, comes back to the forecast with the entry listed and the 85% date later', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    const before = dateAt(text(await page('/')), 85)

    const response = await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const screen = text(await page('/'))
    expect(screen).toContain('0% 2 Nov 2026 to 6 Nov 2026 Offsite')
    expect(Date.parse(dateAt(screen, 85))).toBeGreaterThan(Date.parse(before))
  })

  test('lists a one-day entry by its day and an onward one from its start', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    await addCapacity('0', '2026-11-16', '', 'Holiday')
    await addCapacity('60', '2026-11-23', '', '', true)

    const screen = text(await page('/'))
    expect(screen).toContain('0% on 16 Nov 2026 Holiday')
    expect(screen).toContain('60% from 23 Nov 2026 onward')
  })

  test('refused, shows the forecast again with the section open, saying why, keeping what was typed', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    const response = await addCapacity('50', '2026-09-14', '2026-09-07', 'Half on <leave>')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The end date is before the start.')
    expect(html).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    expect(html).toContain('value="Half on &#60;leave&#62;"')
    expect(html).toContain('value="2026-09-14"')
    expect(text(html)).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('an entry far above usual is warned of beside it', async () => {
    await startOnSavedData()
    await submitPace('4', '8')

    await addCapacity('300', '2026-09-07', '', '', true)

    expect(text(await page('/'))).toContain('At 300%, the pace comes from a team about 33% this size, so it’s a weak guide. A pace range may be better.')
  })

  test('removing an entry takes it off the forecast', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-10-26', '2026-10-30', 'Offsite')

    const response = await post('/capacity/remove', [['id', '1']])

    expect(response.headers.get('location')).toBe('/')
    const screen = text(await page('/'))
    expect(screen).not.toContain('Offsite')
    expect(screen).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026')
  })

  test('with capacity in use, the dates are compared with usual capacity, and the headline says it includes capacity', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    const usual = dateAt(text(await page('/')), 85)

    await addCapacity('0', '2026-11-16', '2026-11-20', 'Offsite')

    const html = await page('/')
    expect(html).toContain('<th>With capacity</th><th>At usual capacity</th>')
    const screen = text(html)
    expect(screen).toMatch(/: 85% confident of finishing by \d+ \w+ 2026 Includes capacity, which moves the 85% date 1 week later\./)
    expect(screen).toMatch(new RegExp(`85% confident by \\d+ \\w+ 2026 ${usual} 1 week later`))
    expect(screen).toContain('Capacity 1 entry · 85% date 1 week later')
  })

  test('switched off, the forecast is without capacity and says its entries are kept; switched on, it is back', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-16', '2026-11-20', 'Offsite')
    const withCapacity = dateAt(text(await page('/')), 85)
    expect(await page('/')).toContain('<form method="post" action="/capacity/switch?capacity=open#capacity"')

    const response = await post('/capacity/switch', [['on', 'false']])

    expect(response.headers.get('location')).toBe('/')
    const html = await page('/')
    const screen = text(html)
    expect(screen).toContain('Starting 1 Sep 2026: 85% confident of finishing by 1 Dec 2026 Capacity is switched off for this forecast; its entries are kept.')
    expect(screen).toContain('Capacity off · 1 entry')
    expect(screen).toContain('Off: the forecast uses pace alone. Entries are kept, and still count for the next milestone.')
    expect(screen).toContain('0% 16 Nov 2026 to 20 Nov 2026 Offsite')
    expect(html).not.toContain('<th>With capacity</th>')
    expect(html).toContain('role="switch" aria-checked="false"')

    await post('/capacity/switch', [['on', 'true']])

    expect(dateAt(text(await page('/')), 85)).toBe(withCapacity)
  })

  test('the week-by-week chart shades each week capacity changes and labels it with its %, leaving usual weeks plain', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    const plain = found(await page('/'), /<figure class="finish-graph"[\s\S]*?<\/figure>/)
    expect(plain).not.toContain('capacity')

    // from Tuesday 1 Sep, a week off from Monday 2 Nov takes one working day of five from the week ending 3 Nov, four from the next
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')

    const html = await page('/')
    const graph = found(html, /<figure class="finish-graph"[\s\S]*?<\/figure>/)
    const bar = (date: string) => found(graph, new RegExp(`<div class="bar[^"]*"[^>]*data-date="${date}"[\\s\\S]*?</div>`))
    expect(text(html)).toContain('Week by week')
    expect(bar('2026-11-03')).toMatch(/class="bar[^"]* changed"/)
    expect(bar('2026-11-03')).toContain('<span class="capacity">80%</span>')
    expect(text(bar('2026-11-10'))).toContain('At 20% capacity.')
    expect(bar('2026-11-17')).not.toContain('changed')
    expect(text(graph)).toContain('Shaded weeks: capacity changes, at the % shown.')
  })

  test('folded, the section gives no entry’s effect; opening it, at its own URL, gives each entry’s effect on the 85% date', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    await addCapacity('0', '2026-11-02', '2026-11-06', 'Offsite')
    await addCapacity('120', '2027-06-01', '', '', true)
    await addCapacity('50', '2026-09-07', '2026-09-11', 'Ended')

    const folded = await page('/')
    expect(folded).toContain('<details class="capacity" id="capacity" data-toggle="/?capacity=open#capacity">')
    expect(text(folded)).not.toContain('85% date +')
    expect(text(folded)).not.toContain('no change to the 85% date')

    const open = await page('/?capacity=open')
    expect(open).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    expect(text(open)).toContain('0% 2 Nov 2026 to 6 Nov 2026 Offsite 85% date +1 wk')
    expect(text(open)).toContain('120% from 1 Jun 2027 onward no change to the 85% date')
    // a past entry isn't used by the forecast, so has no effect to give
    expect(text(open)).toContain('50% 7 Sep 2026 to 11 Sep 2026 Ended Edit')
  })

  test('the section stays open across saves, its effects shown, and across a refusal', async () => {
    await startOnSavedData()
    await submitPace('4', '8')
    expect(await page('/?capacity=open')).toContain('<form method="post" action="/capacity/add?capacity=open#capacity"')

    const saved = await post('/capacity/add?capacity=open', [
      ['percent', '0'],
      ['from', '2026-11-02'],
      ['to', '2026-11-06'],
      ['note', 'Offsite'],
    ])

    expect(saved.headers.get('location')).toBe('/?capacity=open')
    const refused = await post('/capacity/add?capacity=open', [
      ['percent', 'half'],
      ['from', '2026-09-14'],
      ['to', ''],
    ])
    const html = await refused.text()
    expect(html).toContain('<details class="capacity" id="capacity" data-toggle="/#capacity" open>')
    expect(text(html)).toContain('Offsite 85% date +1 wk')
  })

  test("the Inputs screen's pace says where capacity is set", async () => {
    await startOnSavedData()

    expect(text(await page('/inputs'))).toContain('Capacity is set beside the forecast, under Pace.')
  })
})
