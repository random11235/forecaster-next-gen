import { afterEach, describe, expect, test } from 'vitest'
import type { CannedFixture } from '../../src/connectors/canned.js'
import { CHECKOUT, TODAY } from '../trackerScenario.js'
import { appOnTracker, type AppOnTracker } from './appOnTracker.js'
import { post, redirectedTo } from './forms.js'

// The Inputs screen's setup steps (#217), through the local server, on the canned connector: setup's own forms, each
// routed to its edit, and where each goes. Which step is shown, and what the summary says, are Seam B's
// (test/forecast/setup*.test.ts); how they are drawn, the component tests' (test/app/components/setupSection.test.ts,
// inputsScreen.test.ts).

let onTracker: AppOnTracker | undefined

afterEach(async () => {
  await onTracker?.close()
  onTracker = undefined
})

/** The app connected to GitHub, the milestone picked (read at 09:00 with 3 open), setup still open. */
async function picked(): Promise<{ fixture: CannedFixture; onTracker: AppOnTracker }> {
  const fixture: CannedFixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
    reads: { [CHECKOUT.query]: { tickets: [{ id: 'o1' }, { id: 'o2' }, { id: 'o3' }], incomplete: false } },
  }
  onTracker = await appOnTracker(fixture)
  await post(onTracker.running, '/inputs/connect', { tracker: 'github', repo: 'shop-team/shop', token: 'token' })
  await post(onTracker.running, '/inputs/milestone-query/add', { ...CHECKOUT })
  return { fixture, onTracker }
}

describe('setup’s own forms', () => {
  test('"Use these" applies the draft, back to the Inputs screen', async () => {
    const { onTracker } = await picked()
    expect(onTracker.storage.milestoneQuery('team')).toBeUndefined()

    const used = await post(onTracker.running, '/inputs/setup/use-these', {})

    expect(redirectedTo(used)).toBe('/inputs')
    expect(onTracker.storage.milestoneQuery('team')?.query).toBe(CHECKOUT.query)
  })

  test('Change reopens the steps, going to the Milestone step’s section; Change from a refused token’s flag, to the Connect step’s', async () => {
    const { onTracker } = await picked()
    await post(onTracker.running, '/inputs/setup/use-these', {})

    const changed = await post(onTracker.running, '/inputs/setup/change', {})
    expect(redirectedTo(changed)).toBe('/inputs#milestone-tickets')
    expect(onTracker.storage.setupState('team')).toMatchObject({ open: true })

    await post(onTracker.running, '/inputs/setup/use-these', {})
    const toConnect = await post(onTracker.running, '/inputs/setup/change-connection', {})
    expect(redirectedTo(toConnect)).toBe('/inputs?step=connect#connect')
    expect(onTracker.storage.setupState('team')).toMatchObject({ open: true })
  })

  test('Cancel throws away a first setup, its connection too, back to the Inputs screen', async () => {
    const { onTracker } = await picked()

    const cancelled = await post(onTracker.running, '/inputs/setup/cancel', {})

    expect(redirectedTo(cancelled)).toBe('/inputs')
    expect(onTracker.storage.connection('team')).toBeUndefined()
    expect(onTracker.storage.setupDraft('team')).toBeUndefined()
  })

  test('Skip, posted from the Connect step’s form with its fields, closes setup, back to the Inputs screen', async () => {
    onTracker = await appOnTracker({ milestoneChoices: [], reads: {} })

    const skipped = await post(onTracker.running, '/inputs/setup/skip', { tracker: 'github', repo: '', token: '' })

    expect(redirectedTo(skipped)).toBe('/inputs')
    expect(onTracker.storage.setupState('team')).toMatchObject({ open: false })
    expect(onTracker.storage.connection('team')).toBeUndefined()
  })

  test('Read again reads the tracker again, back to the Inputs screen', async () => {
    const { fixture, onTracker } = await picked()
    await post(onTracker.running, '/inputs/setup/use-these', {})
    onTracker.readAt(`${TODAY}T14:30:00Z`)
    fixture.reads[CHECKOUT.query] = { tickets: [{ id: 'o1' }], incomplete: false }

    const read = await post(onTracker.running, '/inputs/setup/read-again', {})

    expect(redirectedTo(read)).toBe('/inputs')
    expect(onTracker.storage.savedRead({ teamId: 'team', query: CHECKOUT.query })).toMatchObject({ readAt: `${TODAY}T14:30:00Z`, tickets: [{ id: 'o1' }] })
  })
})
