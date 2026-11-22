import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { TEAM } from '../trackerScenario.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { post } from './forms.js'

// Tickets remaining's source (#211): the forms the browser posts, read into what is stored. What the Inputs screen
// shows of it is test/forecast/ticketsSource.test.ts's and test/app/components/inputsScreen.sources.test.ts's.

const CHECKOUT = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' } as const

const FIXTURE: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
  reads: { [CHECKOUT.query]: { tickets: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }], incomplete: false } },
}

let app: AppOnTracker | undefined

afterEach(async () => {
  await app?.close()
  app = undefined
})

/** The app, its milestone entered with 30 tickets typed, connected to GitHub with them picked. */
async function start(): Promise<RunningApp> {
  app = await appOnTracker(FIXTURE)
  const { running } = app
  await post(running, '/inputs/milestone', { name: 'Checkout v2', startDate: '2026-11-16', ticketsRemaining: '30' })
  await post(running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(running, '/inputs/milestone-query/add', CHECKOUT)
  await post(running, '/inputs/setup/use-these', {})
  return running
}

describe('tickets remaining’s source', () => {
  test('choosing GitHub is saved, and lands back on the Inputs screen', async () => {
    const running = await start()

    const chosen = await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    expect(chosen.status).toBe(303)
    expect(chosen.headers.get('location')).toBe('/inputs')
    expect(app?.storage.milestoneInputs(TEAM)?.ticketsSource).toBe('tracker')
  })

  test('the milestone saved with no tickets remaining field keeps following GitHub', async () => {
    const running = await start()
    await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    await post(running, '/inputs/milestone', { name: 'Checkout v3', startDate: '2026-11-16' })

    expect(app?.storage.milestoneInputs(TEAM)).toMatchObject({ name: 'Checkout v3', ticketsSource: 'tracker' })
  })
})
