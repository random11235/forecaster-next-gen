import { afterEach, describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { CHECKOUT, finishedOn, open } from '../trackerScenario.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { post } from './forms.js'

// The Check step (#220), through the local server, on the canned connector: how a choice's form is read, and where it
// goes. What Check offers and what "Use these" saves are Seam B's (test/forecast/setup.check.test.ts); how its rows are
// drawn, the component test's (test/app/components/setupSection.test.ts).

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The app connected to GitHub, its milestone typed as 30 tickets with a pace of 4–8 a week, then picked from the tracker. */
async function atCheck(): Promise<AppOnTracker> {
  const fixture: CannedFixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
    reads: { [CHECKOUT.query]: { tickets: [...open(7), ...finishedOn('f', '2026-11-03', 6)], incomplete: false } },
  }
  app = await appOnTracker(fixture)
  await post(app.running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(app.running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-09-01', ticketsRemaining: '30' })
  await post(app.running, '/inputs/pace', { low: '4', high: '8' })
  await post(app.running, '/inputs/milestone-query/add', { ...CHECKOUT })
  return app
}

describe('the Check step', () => {
  test('a choice is read from its form, tickets remaining’s or pace’s, and goes back to Check', async () => {
    const running = await atCheck()

    const chosen = await post(running.running, '/inputs/setup/source', { value: 'ticketsRemaining', source: 'tracker' })
    expect(chosen.status).toBe(303)
    expect(chosen.headers.get('location')).toBe('/inputs?step=check#check')
    await post(running.running, '/inputs/setup/source', { value: 'pace', source: 'tracker' })
    expect(running.storage.setupDraft('team')?.sources).toEqual({ ticketsRemaining: 'tracker', pace: 'tracker' })
  })

  test('a source Check doesn’t name, as from a form changed by hand, is not found, and changes nothing', async () => {
    const running = await atCheck()

    expect((await post(running.running, '/inputs/setup/source', { value: 'ticketsRemaining', source: 'range' })).status).toBe(404)
    expect((await post(running.running, '/inputs/setup/source', { value: 'ambiguity', source: 'tracker' })).status).toBe(404)
    expect(running.storage.setupDraft('team')?.sources).toBeUndefined()
  })
})
