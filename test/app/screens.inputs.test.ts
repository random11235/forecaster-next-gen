import { describe, expect, test } from 'vitest'
import { startOnSavedData, startWithNoMilestone, page, text, submitMilestone, submitPace, submitCadence } from './screensHarness.js'
import { found } from './found.js'

// The screens through the local server: see screensHarness.ts.

describe('Inputs screen', () => {
  test('asks for the milestone name, start date and tickets remaining, and pace as a low–high range per week', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="text" name="name"[^>]*value="Checkout v2"/)
    expect(html).toMatch(/<input type="date" name="startDate"[^>]*value="2026-09-01"/)
    expect(html).toMatch(/<input type="number" name="ticketsRemaining"[^>]*value="40"/)
    expect(html).toMatch(/<input[^>]*name="low"/)
    expect(html).toMatch(/<input[^>]*name="high"/)
    expect(text(html)).toContain('tickets per week')
  })

  test('offers no committed date, no epics and no measured pace', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html).not.toMatch(/committedDate|name="rank-|\/inputs\/epics|\/inputs\/pace\/source/)
  })

  test('with nothing entered, pre-fills the start date with today and leaves the rest blank', async () => {
    await startWithNoMilestone()

    const html = await page('/inputs')

    expect(html).toMatch(/name="name"[^>]*value=""/)
    expect(html).toMatch(/name="startDate"[^>]*value="2026-10-24"/)
    expect(html).toMatch(/name="ticketsRemaining"[^>]*value=""/)
    expect(html).not.toContain('class="warning"')
  })

  test('shows no absence or capacity input: capacity is typed beside the forecast', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html.toLowerCase()).not.toMatch(/absence|\/capacity/)
    expect(html).not.toMatch(/name="(percent|onward)"/)
  })

  test('saving the milestone shows it on the Inputs screen', async () => {
    await startWithNoMilestone()

    const response = await submitMilestone('Checkout v2', '2026-08-03', '25')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const html = await page('/inputs')
    expect(html).toMatch(/name="startDate"[^>]*value="2026-08-03"/)
    expect(html).toMatch(/name="ticketsRemaining"[^>]*value="25"/)
  })

  test('saving a pace range goes to the Milestone forecast screen, and the Inputs screen shows the saved range', async () => {
    await startOnSavedData()

    const response = await submitPace('3', '6')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const inputs = await page('/inputs')
    expect(inputs).toMatch(/name="low"[^>]*value="3"/)
    expect(inputs).toMatch(/name="high"[^>]*value="6"/)
  })

  test.each([
    [['Checkout v2', '', '40'], 'Enter the start date as a calendar date.'],
    [['Checkout v2', '2026-09-01', '-1'], 'Enter tickets remaining as a whole number, 0 or more.'],
    [['Checkout v2', '2026-09-01', '2.5'], 'Enter tickets remaining as a whole number, 0 or more.'],
  ] as const)('refuses the milestone %j, saying why, keeping what was typed and changing nothing', async ([name, startDate, tickets], error) => {
    await startOnSavedData()

    const response = await submitMilestone(name, startDate, tickets)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain(error)
    expect(html).toMatch(new RegExp(`name="startDate"[^>]*value="${startDate}"`))
    expect(html).toMatch(new RegExp(`name="ticketsRemaining"[^>]*value="${tickets}"`))
    expect(await page('/inputs')).toMatch(/name="ticketsRemaining"[^>]*value="40"/)
  })

  test('refuses a pace the rules forbid, saying why and keeping what was typed', async () => {
    await startOnSavedData()

    const response = await submitPace(' 6 ', '3')

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('The low end must not be above the high end.')
    expect(html).toMatch(/name="low"[^>]*value="6"/)
    expect(text(await page('/'))).toContain('Pace: Enter a pace range.')
  })

  test('every form posts to a fragment naming where it sits, so the browser lands on why, should it be refused', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    const actions = [...html.matchAll(/<form[^>]*action="([^"]+)"/g)].flatMap(([, action]) => action ?? [])
    expect(actions).toHaveLength(9)
    for (const action of actions) {
      const fragment = action.split('#')[1]
      expect(fragment, action).toMatch(/^[a-z-]+$/)
      expect(found(html, new RegExp(`<[a-z]+[^>]*id="${fragment}"[\\s\\S]*?</section>`))).toContain(`action="${action}"`)
    }
    expect(html).toContain('action="/inputs/growth#growth"')
  })

  test('shows a warning beside the input it is about', async () => {
    await startOnSavedData()
    await submitPace('0', '0')

    const html = await page('/inputs')

    expect(html).toMatch(/name="high"[^>]*>[\s\S]*?<p class="warning">⚠ At 0 tickets a week, the work never finishes.<\/p>[\s\S]*?Save and forecast/)
  })
})

describe('Inputs screen: a start date in the past', () => {
  test('notes beside the start date how many days before today it is', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html).toMatch(
      /name="startDate"[^>]*><\/label>\s*<p class="warning">⚠ Start date is 53 days before today; tickets remaining are still today&#39;s count.<\/p>\s*<label>Tickets remaining/,
    )
  })

  test('shows no note for a start date of today', async () => {
    await startOnSavedData()
    await submitMilestone('Checkout v2', '2026-10-24', '40')

    expect(text(await page('/inputs'))).not.toContain('before today')
  })
})

describe('Inputs screen: cadence', () => {
  test('offers the cadence length in days, 7 for an untouched milestone', async () => {
    await startOnSavedData()

    const html = await page('/inputs')

    expect(html).toMatch(/<input type="number" name="cadenceDays"[^>]*value="7"/)
    expect(text(html)).toContain('Cadence length')
    expect(text(html)).toContain('At 7 days a period is a week, so pace is entered per week; any other length makes it a sprint.')
  })

  test('saving a 14-day cadence shows it, and the pace input and its warning say per sprint', async () => {
    await startOnSavedData()
    await submitPace('0', '0')

    const response = await submitCadence('14')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    const html = await page('/inputs')
    expect(html).toMatch(/name="cadenceDays"[^>]*value="14"/)
    expect(text(html)).toContain('tickets per sprint')
    expect(text(html)).toContain('At 14 days a period is a sprint, so pace is entered per sprint; 7 days makes it a week.')
    expect(text(html)).not.toContain('tickets per week')
    expect(text(html)).toContain('At 0 tickets a sprint, the work never finishes.')
  })

  test.each(['0', '1.5', 'two'])('refuses a cadence of %j, saying why, keeping what was typed and changing nothing', async (typed) => {
    await startOnSavedData()

    const response = await submitCadence(typed)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain('Enter the cadence as a whole number of days, 1 or more.')
    expect(html).toMatch(new RegExp(`name="cadenceDays"[^>]*value="${typed}"`))
    expect(await page('/inputs')).toMatch(/name="cadenceDays"[^>]*value="7"/)
  })
})
