import { afterEach, describe, expect, test } from 'vitest'
import type { RunningApp } from '../../src/app/launch.js'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { CHECKOUT, TEAM } from '../trackerScenario.js'
import { appOnTracker, connectAndPick, type AppOnTracker } from './appOnTracker.js'
import { post, redirectedTo } from './forms.js'

// Tickets remaining's source (#211): the forms the browser posts, read into what is stored. What the Inputs screen
// shows of it is test/forecast/ticketsSource.test.ts's and test/app/components/inputsScreen.sources.test.ts's.

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
  await connectAndPick(running)
  await post(running, '/inputs/setup/use-these', {})
  return running
}

describe('tickets remaining’s source', () => {
  test('choosing GitHub is saved, and lands back on the Inputs screen', async () => {
    const running = await start()

    const chosen = await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    expect(redirectedTo(chosen)).toBe('/inputs')
    expect(app?.storage.milestoneInputs(TEAM)?.ticketsSource).toBe('tracker')
  })

  test('the milestone saved while following GitHub, with no tickets remaining field, reads none, and is saved', async () => {
    const running = await start()
    await post(running, '/inputs/tickets-source', { ticketsSource: 'tracker' })

    const saved = await post(running, '/inputs/milestone', { name: 'Checkout v3', startDate: '2026-11-16' })

    expect(redirectedTo(saved)).toBe('/inputs')
    expect(app?.storage.milestoneInputs(TEAM)?.name).toBe('Checkout v3')
  })

  test('a reading opened is kept as seen, its field read; posted with none, it is refused, and nothing kept', async () => {
    const running = await start()

    const missing = await post(running, '/inputs/reading-opened', {})
    expect(missing.status).toBe(400)
    expect(app?.storage.milestoneInputs(TEAM)?.seenReads.ticketsRemaining).toBeUndefined()

    const opened = await post(running, '/inputs/reading-opened', { reading: 'ticketsRemaining' })
    expect(redirectedTo(opened)).toBe('/inputs')
    expect(app?.storage.milestoneInputs(TEAM)?.seenReads.ticketsRemaining).toBeDefined()
  })
})
