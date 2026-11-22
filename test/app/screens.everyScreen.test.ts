import { describe, expect, test } from 'vitest'
import { running, startOnSavedData, startWithNoMilestone, page } from './screensHarness.js'
import { found } from './found.js'

// The screens through the local server: see screensHarness.ts. The Milestone forecast and How it works screens' sidebar,
// icon and fonts are their component tests' (components/milestoneForecastScreen.test.ts, howItWorksScreen.test.ts);
// the Inputs screen's stay here until its component test has them.

describe('How it works screen', () => {
  test('is served before a milestone is entered, and the Inputs screen links to it from the sidebar', async () => {
    await startWithNoMilestone()

    const howItWorks = await fetch(new URL('/how-it-works', running().url))

    expect(howItWorks.status).toBe(200)
    expect(await howItWorks.text()).toContain('<a href="/how-it-works" aria-current="page">How it works</a>')
    expect(await page('/inputs')).toContain('<a href="/how-it-works">How it works</a>')
  })
})

describe('The Inputs screen', () => {
  test('links the favicon in its head, inline as an SVG', async () => {
    await startOnSavedData()

    const head = found(await page('/inputs'), /<head>[\s\S]*?<\/head>/)
    expect(head).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]*%3Csvg[^"]*">/)
  })

  test('has its fonts, Geist and Geist Mono, inline in its head, so it loads nothing from outside', async () => {
    await startOnSavedData()

    const screen = await page('/inputs')
    const head = found(screen, /<head>[\s\S]*?<\/head>/)
    for (const family of ['Geist', 'Geist Mono']) {
      expect(head).toMatch(new RegExp(`@font-face \\{ font-family: '${family}'; src: url\\(data:font/woff2;base64,[A-Za-z0-9+/=]+\\)`))
    }
    expect(screen).not.toMatch(/(?:href=|src=|url\()["']?(?:https?:)?\/\//)
    expect(screen).not.toMatch(/@import/)
  })
})
