import { describe, expect, test } from 'vitest'
import { running, startWithNoMilestone } from './screensHarness.js'

// The screens through the local server: see screensHarness.ts. Each screen's sidebar, icon and fonts are its component
// test's (components/milestoneForecastScreen.test.ts, howItWorksScreen.test.ts, inputsScreen.test.ts).

describe('How it works screen', () => {
  test('is served before a milestone is entered', async () => {
    await startWithNoMilestone()

    const howItWorks = await fetch(new URL('/how-it-works', running().url))

    expect(howItWorks.status).toBe(200)
    expect(await howItWorks.text()).toContain('<a href="/how-it-works" aria-current="page">How it works</a>')
  })
})
