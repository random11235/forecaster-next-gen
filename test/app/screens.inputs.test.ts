import { describe, expect, test } from 'vitest'
import { redirectedTo } from './forms.js'
import { post, startOnSavedData, startWithNoMilestone, stored, submitCounts, submitMilestone, submitPace, submitCadence, TEAM } from './screensHarness.js'

// The Inputs screen's forms through the local server (see screensHarness.ts): each read as the browser posts it into
// what is stored. What the screen shows, and what it refuses, are test/forecast/milestoneForecastView.inputs.test.ts's
// and test/app/components/inputsScreen.test.ts's.

describe('Inputs screen', () => {
  test('the milestone is saved from its fields', async () => {
    await startWithNoMilestone()

    const response = await submitMilestone('Checkout v2', '2026-08-03', '25')

    expect(redirectedTo(response)).toBe('/inputs')
    expect(stored().milestoneInputs(TEAM)).toMatchObject({ name: 'Checkout v2', startDate: '2026-08-03', ticketsRemaining: 25 })
  })

  test('a pace range is saved from its low and high', async () => {
    await startOnSavedData()

    const response = await submitPace('6', '8')

    expect(response.status).toBe(303)
    expect(stored().milestoneInputs(TEAM)?.paceRange).toEqual({ low: 6, high: 8 })
  })

  test('a refused milestone is a 400, and changes nothing', async () => {
    await startOnSavedData()

    const response = await submitMilestone('Checkout v2', '2026-09-01', '-1')

    expect(response.status).toBe(400)
    expect(stored().milestoneInputs(TEAM)?.ticketsRemaining).toBe(40)
  })

  test('the cadence is saved from its length in days', async () => {
    await startOnSavedData()

    const response = await submitCadence('14')

    expect(redirectedTo(response)).toBe('/inputs')
    expect(stored().milestoneInputs(TEAM)?.cadenceDays).toBe(14)
  })

  const TICKETS_REMAINING: [string, string] = ['ticketsRemaining', '25']
  const TYPED: [string, string][] = [['startDate', '2026-10-01'], TICKETS_REMAINING]
  test.each<[string, [string, string][]]>([
    ['/inputs/milestone', TYPED],
    ['/inputs/milestone', [['name', 'Checkout v3'], TICKETS_REMAINING]],
    ['/inputs/tickets-source', []],
    ['/inputs/cadence', []],
    ['/inputs/pace', []],
    ['/inputs/pace-mode', []],
    ['/inputs/pace-counts/add', []],
    ['/inputs/ambiguity', []],
    ['/inputs/growth', []],
  ])('%s posted without a field reads it as empty: refused with a 400, nothing changed (posted %j)', async (path, fields) => {
    await startOnSavedData()
    const before = stored().milestoneInputs(TEAM)

    const refused = await post(path, fields)

    expect(refused.status).toBe(400)
    expect(stored().milestoneInputs(TEAM)).toEqual(before)
  })

  test('the typed counts posted without their field read as none typed: the list cleared', async () => {
    await startOnSavedData()
    await submitCounts('6, 4, 9')

    const cleared = await post('/inputs/pace-counts', [])

    expect(cleared.status).toBe(303)
    expect(stored().milestoneInputs(TEAM)?.paceCounts).toEqual([])
  })
})
