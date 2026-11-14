import { afterEach, describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned/cannedConnector.js'
import { CHECKOUT, finishedOn, open } from '../trackerScenario.js'
import { appOnTracker, inputsSection, page, post, type AppOnTracker } from './appOnTracker.js'

// The Check step (#220), through the local server as the EM's browser sees it, on the canned connector: a row for
// each value the tracker can supply, the EM's value now, the tracker's and which to use, then "Use these".

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The app connected to `tracker`, its milestone typed as 30 tickets with a pace of 4–8 a week, then picked from the tracker. */
async function atCheck({ tracker = 'github', incomplete = false }: { tracker?: 'github' | 'jira'; incomplete?: boolean } = {}): Promise<AppOnTracker> {
  const fixture: CannedFixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
    reads: { [CHECKOUT.query]: { tickets: [...open(7), ...finishedOn('f', '2026-11-03', 6)], incomplete } },
  }
  app = await appOnTracker(fixture)
  const connection = tracker === 'github' ? { tracker, repo: 'shop-team/shop' } : { tracker, site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test' }
  await post(app.running, '/inputs/connect', { ...connection, token: 'token' })
  await post(app.running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '30' })
  await post(app.running, '/inputs/pace', { low: '4', high: '8' })
  await post(app.running, '/inputs/milestone-query/add', { ...CHECKOUT })
  return app
}

/** The Check step's section. */
const check = async ({ running }: AppOnTracker): Promise<string> => {
  const html = await page(running, '/inputs?step=check')
  const start = html.indexOf('id="check"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

describe('the Check step', () => {
  test('shows a row for tickets remaining and pace: the EM’s value now, the tracker’s reading, and which to use, on its current source', async () => {
    const html = await check(await atCheck())

    expect(html).toMatch(/<th scope="col">Yours now<\/th>\s*<th scope="col">From GitHub<\/th>\s*<th scope="col">Use<\/th>/)
    expect(html).toMatch(/<th scope="row">Tickets remaining<\/th>\s*<td>30<\/td>\s*<td>7<\/td>/)
    expect(html).toMatch(/<input type="radio" name="source" value="tracker" required> GitHub<\/label>\s*<label><input type="radio" name="source" value="typed" checked required> Typed<\/label>/)
    expect(html).toMatch(/<th scope="row">Pace<\/th>\s*<td>4–8 a week<\/td>\s*<td>6 <span class="muted">/)
    expect(html).toMatch(/value="tracker" required> GitHub<\/label>\s*<label><input type="radio" name="source" value="range" checked required> Range<\/label>/)
  })

  test('a choice is held for "Use these", which saves it with the picks and closes setup', async () => {
    const running = await atCheck()

    const chosen = await post(running.running, '/inputs/setup/source', { value: 'ticketsRemaining', source: 'tracker' })
    expect(chosen.status).toBe(303)
    expect(chosen.headers.get('location')).toBe('/inputs?step=check#check')
    expect(await check(running)).toMatch(/value="tracker" checked required> GitHub<\/label>\s*<label><input type="radio" name="source" value="typed" required> Typed/)
    expect(running.storage.milestoneInputs('team')?.ticketsSource).toBe('typed')

    await post(running.running, '/inputs/setup/use-these', {})
    expect(running.storage.milestoneInputs('team')).toMatchObject({ ticketsSource: 'tracker', paceMode: 'range' })
    expect(await inputsSection(running.running, 'milestone')).not.toContain('name="ticketsRemaining"')
  })

  test('marks an incomplete read on its row', async () => {
    const html = await check(await atCheck({ incomplete: true }))

    expect(html).toMatch(/<td>7 <span class="note warn">GitHub gave only part of what the query matches<\/span><\/td>/)
    expect(html).toMatch(/<td><span class="note warn">None: GitHub gave only part of what the query matches<\/span><\/td>/)
  })

  test('names Jira', async () => {
    const html = await check(await atCheck({ tracker: 'jira' }))

    expect(html).toContain('<th scope="col">From Jira</th>')
    expect(html).toContain('> Jira</label>')
  })
})
