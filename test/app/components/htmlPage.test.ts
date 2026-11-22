import { describe, expect, test } from 'vitest'
import { renderHowItWorksScreen } from '../../../src/app/howItWorksScreen.js'
import { renderInputsScreen } from '../../../src/app/inputsScreen.js'
import { renderMilestoneForecastScreen } from '../../../src/app/milestoneForecastScreen.js'
import { forecastingForTest } from '../../forecast/forecastingForTest.js'
import { allByRole, byRole, one, render, text } from '../dom.js'
import { entered, forecast } from './milestoneForecastScreenHarness.js'

// What every screen carries around its own (#236): the sidebar, its own screen marked current, and the head with the
// icon and fonts inline, so a screen loads nothing from anywhere. Each screen drawn from a view Seam B gives.

const SCREENS = [
  ['Milestone forecast', '/', async () => renderMilestoneForecastScreen(forecast(await (await entered('100', ['4', '8'])).milestoneForecastView()))],
  ['Inputs', '/inputs', async () => renderInputsScreen(await (await forecastingForTest()).browserBuild().inputsScreen(), () => 'opening-1')],
  ['How it works', '/how-it-works', async () => renderHowItWorksScreen(await (await forecastingForTest()).howItWorksView())],
] as const

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
})
