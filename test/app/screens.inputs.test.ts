import { describe, expect, test } from 'vitest'
import { startOnSavedData, startWithNoMilestone, stored, submitMilestone, submitPace, submitCadence, TEAM } from './screensHarness.js'

// The Inputs screen's forms through the local server (see screensHarness.ts): each read as the browser posts it into
// what is stored. What the screen shows, and what it refuses, are test/forecast/milestoneForecastView.inputs.test.ts's
// and test/app/components/inputsScreen.test.ts's.

describe('Inputs screen', () => {
  test('the milestone is saved from its fields', async () => {
    await startWithNoMilestone()

    const response = await submitMilestone('Checkout v2', '2026-08-03', '25')

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
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

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/inputs')
    expect(stored().milestoneInputs(TEAM)?.cadenceDays).toBe(14)
  })
})
