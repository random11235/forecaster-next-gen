import { describe, expect, test } from 'vitest'
import { running, startOnSavedData, startWithNoMilestone, page, text } from './screensHarness.js'
import { found } from './found.js'

// The screens through the local server: see screensHarness.ts.

describe('How it works screen', () => {
  test('every screen links to it from the sidebar, and it is served before a milestone is entered', async () => {
    await startWithNoMilestone()

    const forecast = await page('/')
    const inputs = await page('/inputs')
    const howItWorks = await fetch(new URL('/how-it-works', running().url))

    expect(forecast).toContain('<a href="/how-it-works">How it works</a>')
    expect(inputs).toContain('<a href="/how-it-works">How it works</a>')
    expect(howItWorks.status).toBe(200)
    expect(await howItWorks.text()).toContain('<a href="/how-it-works" aria-current="page">How it works</a>')
  })

  test('explains the problem, how it works and how to make it better, on the example, with its 50% and 85% weeks', async () => {
    await startWithNoMilestone()

    const screen = text(await page('/how-it-works'))

    expect(screen).toContain('A forecast, not an estimate')
    expect(screen).toContain('30 tickets remaining, medium ambiguity, 4–8 a week')
    expect(screen).toMatch(/The problem .* How it works .* Making it better/)
    expect(screen).toMatch(/50% wk \d+/)
    expect(screen).toMatch(/85% wk \d+/)
    expect(screen).toMatch(/met in \d+% of simulations/)
  })
})

describe('Every screen', () => {
  test('links the favicon in its head, inline as an SVG', async () => {
    await startOnSavedData()

    for (const path of ['/', '/inputs']) {
      const head = found(await page(path), /<head>[\s\S]*?<\/head>/)
      expect(head).toMatch(/<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,[^"]*%3Csvg[^"]*">/)
    }
  })

  test('has its fonts, Geist and Geist Mono, inline in its head, so it loads nothing from outside', async () => {
    await startOnSavedData()

    for (const path of ['/', '/inputs', '/how-it-works']) {
      const screen = await page(path)
      const head = found(screen, /<head>[\s\S]*?<\/head>/)
      for (const family of ['Geist', 'Geist Mono']) {
        expect(head).toMatch(new RegExp(`@font-face \\{ font-family: '${family}'; src: url\\(data:font/woff2;base64,[A-Za-z0-9+/=]+\\)`))
      }
      expect(screen).not.toMatch(/(?:href=|src=|url\()["']?(?:https?:)?\/\//)
      expect(screen).not.toMatch(/@import/)
    }
  })
})
