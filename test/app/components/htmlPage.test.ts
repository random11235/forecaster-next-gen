import { describe, expect, test } from 'vitest'
import { APP_VERSION } from '../../../src/forecast/index.js'
import { allByRole, byRole, hasRole, one, render, text } from '../dom.js'
import { SCREENS } from './htmlPageHarness.js'

// What every screen carries around its own (#236): the sidebar, its own screen marked current, and the head with the
// icon and fonts inline, so a screen loads nothing from anywhere. Each screen drawn from a view Seam B gives.

describe('every screen', () => {
  test.each(SCREENS)(
    '%s: the sidebar links each screen, this one marked current; the head carries the icon and fonts inline, loading nothing',
    async (_, path, drawn) => {
      const html = await drawn()
      const page = render(html)

      expect(allByRole(byRole(page, 'navigation'), 'link').map((link) => [text(link), link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual(
        SCREENS.map(([name, href]) => [name, href, href === path ? 'page' : null]),
      )
      expect(one(page, 'head link[rel="icon"]').getAttribute('href')).toMatch(/^data:image\/svg\+xml,%3Csvg/)
      for (const family of ['Geist', 'Geist Mono']) expect(one(page, 'head style#fonts').textContent).toContain(`font-family: '${family}'`)
      expect(one(page, 'head style#fonts').textContent).toMatch(/url\(data:font\/woff2;base64,/)
      expect(html).not.toMatch(/(?:href=|src=|url\()["']?(?:https?:)?\/\//)
      expect(html).not.toContain('@import')
    },
  )

  test.each(SCREENS)('%s: with no GitHub repo recorded, the footer shows the version alone, with no Send feedback link', async (_, __, drawn) => {
    const page = render(await drawn())

    expect(text(one(page, 'footer'))).toBe(`Forecaster ${APP_VERSION}`)
    expect(hasRole(page, 'link', { name: 'Send feedback' })).toBe(false)
  })
})
