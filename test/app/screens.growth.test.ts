import { describe, expect, test } from 'vitest'
import { startOnSavedData, post, stored, growthForm, TEAM } from './screensHarness.js'

// The Inputs screen's ambiguity and growth through the local server (see screensHarness.ts): each form read as the
// browser posts it into what is stored. What the screen shows of them, what it refuses and how they move the forecast
// are test/forecast/milestoneForecastView.forms.test.ts's and test/app/components/inputsScreen.test.ts's.

describe('Inputs screen: ambiguity', () => {
  test('choosing high is saved', async () => {
    await startOnSavedData()

    const response = await post('/inputs/ambiguity', [['ambiguity', 'high']])

    expect(response.status).toBe(303)
    expect(stored().milestoneInputs(TEAM)?.ambiguity).toBe('high')
  })
})

describe('Inputs screen: growth', () => {
  test('the ranges are saved, each from its level and end’s field', async () => {
    await startOnSavedData()

    const response = await post('/inputs/growth', growthForm({ 'medium-high': '3', 'high-low': '1.25' }))

    expect(response.status).toBe(303)
    expect(stored().ambiguityRanges(TEAM)).toMatchObject({ medium: { high: 3 }, high: { low: 1.25 } })
  })

  test('has no measured growth to post to', async () => {
    await startOnSavedData()

    expect((await post('/inputs/growth/medium', [['source', 'measured']])).status).toBe(404)
  })
})
