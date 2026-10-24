import { afterEach, describe, expect, test } from 'vitest'
import { startAppAndOpenBrowser, type RunningApp } from '../../src/app/launch.js'
import { openSqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { Storage } from '../../src/storage/storage.js'

// The screens on the canned sample data, through the local server, as the EM's browser sees them.

let app: RunningApp | undefined
let storage: Storage | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
  storage?.close()
  storage = undefined
})

/** Starts the app on the sample data, on 24 Oct 2026. */
async function startOnSampleData(): Promise<RunningApp> {
  storage = openSqliteStorage(':memory:')
  app = await startAppAndOpenBrowser({ port: 0, openBrowser: () => {}, storage, today: () => '2026-10-24' })
  return app
}

async function page(path: string): Promise<string> {
  return (await fetch(new URL(path, app!.url))).text()
}

/** Submits the Inputs screen's pace form as the browser does. */
function submitPace(low: string, high: string): Promise<Response> {
  return fetch(new URL('/inputs', app!.url), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ low, high }).toString(),
    redirect: 'manual',
  })
}

/** The page's visible text, with tags removed and spaces collapsed. */
function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
}

describe('Inputs screen', () => {
  test('asks for pace as a low–high range of tickets per week', async () => {
    await startOnSampleData()

    const html = await page('/inputs')

    expect(text(html)).toContain('Pace')
    expect(html).toMatch(/<input[^>]*name="low"/)
    expect(html).toMatch(/<input[^>]*name="high"/)
    expect(text(html)).toContain('tickets per week')
  })

  test('shows no absence input', async () => {
    await startOnSampleData()

    expect((await page('/inputs')).toLowerCase()).not.toMatch(/absence|capacity/)
  })

  test('saving a pace range goes to the Milestone forecast screen, and the Inputs screen shows the saved range', async () => {
    await startOnSampleData()

    const response = await submitPace('3', '6')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/')
    const inputs = await page('/inputs')
    expect(inputs).toMatch(/name="low"[^>]*value="3"/)
    expect(inputs).toMatch(/name="high"[^>]*value="6"/)
  })

  test.each([
    { low: '6', high: '3', message: 'The low end must not be above the high end.' },
    { low: 'two', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '1.5', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '-1', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '', high: '6', message: 'Enter whole numbers of tickets, 0 or more.' },
    { low: '1', high: '1000000', message: 'Enter at most 1000 tickets per week.' },
  ])('refuses $low to $high, saying why and keeping what was typed', async ({ low, high, message }) => {
    await startOnSampleData()

    const response = await submitPace(low, high)

    expect(response.status).toBe(400)
    const html = await response.text()
    expect(text(html)).toContain(message)
    expect(html).toMatch(new RegExp(`name="low"[^>]*value="${low}"`))
    expect(text(await page('/'))).toContain('Enter your pace on the Inputs screen')
  })
})

describe('Milestone forecast screen', () => {
  test('before pace is entered, points the EM to the Inputs screen', async () => {
    await startOnSampleData()

    const html = await page('/')

    expect(text(html)).toContain('Enter your pace on the Inputs screen to see a forecast.')
    expect(html).toContain('href="/inputs"')
  })

  test('shows the finish dates at 50%, 85% and 95% and the manual pace they come from', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const screen = text(await page('/'))

    expect(screen).toMatch(/50% sure by \d{1,2} [A-Z][a-z]{2} 20\d\d/)
    expect(screen).toMatch(/85% sure by \d{1,2} [A-Z][a-z]{2} 20\d\d/)
    expect(screen).toMatch(/95% sure by \d{1,2} [A-Z][a-z]{2} 20\d\d/)
    expect(screen).toContain('Pace: 3–6 tickets per week (manual)')
  })

  test('labels each epic "Not committed: wide range"', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const screen = text(await page('/'))

    expect(screen.match(/Not committed: wide range/g)).toHaveLength(3)
  })

  test('shows no absence input', async () => {
    await startOnSampleData()
    await submitPace('3', '6')

    const html = await page('/')

    expect(html).not.toMatch(/<input/)
    expect(html.toLowerCase()).not.toMatch(/absence|capacity/)
  })

  test('shows the forecast notes and the pace they come from, for measured pace', async () => {
    await startOnSampleData()
    storage!.savePaceSetting({ teamId: 'sample-team', milestoneId: 'sample-milestone', mode: 'measured' })

    const html = await page('/')

    expect(html).toMatch(/<p class="note">[^<]+<\/p>/)
    expect(text(html)).toContain('Pace: measured')
  })
})
