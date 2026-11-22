import { beforeAll, describe, expect, test } from 'vitest'
import { renderHowItWorksScreen } from '../../../src/app/howItWorksScreen.js'
import type { HowItWorksView } from '../../../src/forecast/index.js'
import { forecastingForTest } from '../../forecast/forecastingForTest.js'
import { accessibleName, allByRole, byRole, one, render, text } from '../dom.js'

// The How it works screen (#236), rendered from the example's view Seam B gives, started no server: its three parts,
// each picture named for a screen reader, and the example's simulations as they finish. What the example forecasts is
// Seam B's (test/forecast/howItWorksView.test.ts).

describe('the How it works screen', () => {
  let view: HowItWorksView
  let page: ReturnType<typeof render>
  beforeAll(async () => {
    view = await (await forecastingForTest()).howItWorksView()
    page = render(renderHowItWorksScreen(view))
  })

  test('headed by the example, in three numbered parts', () => {
    expect(text(one(page, 'header'))).toMatch(/^Example: 30 tickets remaining, medium ambiguity, 4–8 a week A forecast, not an estimate Like the weather/)
    expect(allByRole(page, 'region').map((part) => accessibleName(part))).toEqual(['The problem', 'How it works', 'Making it better'])
    expect(allByRole(byRole(page, 'region', { name: 'Making it better' }), 'heading').map((heading) => text(heading))).toEqual([
      'Making it better',
      'Type real counts, 8 weeks or more',
      'Keep tickets a similar size',
      'Pick ambiguity honestly',
      'Re-forecast every week',
    ])
  })

  test('the burndown at the example’s average pace, against when its simulations finish', () => {
    const problem = byRole(page, 'region', { name: 'The problem' })

    expect(accessibleName(byRole(problem, 'img'))).toMatch(new RegExp(`^A straight burndown at the average pace reaches 0 in week ${view.averagePace.period}`))
    expect(text(problem)).toContain(`average pace (${view.averagePace.perPeriod}/wk): week ${view.averagePace.period}`)
  })

  test('each step of a simulation a captioned picture, the last counting the example’s finishes', () => {
    const steps = allByRole(byRole(page, 'region', { name: 'How it works' }), 'figure')

    expect(steps.map((step) => accessibleName(step))).toEqual([
      'Draw a growth from your ambiguity range (medium: 1–2×).',
      'Draw each week’s pace from your range or typed counts until no tickets are left.',
      'Every simulation draws again, so each finishes in a different week.',
      'Count the finishes. The 85% date is the week by which 85 in 100 simulations were done.',
    ])
    expect(accessibleName(byRole(steps[2]!, 'img'))).toBe(`Six simulations finish in weeks ${view.someFinishes.join(', ')}.`)
    const [half, sure] = view.weeks
    expect(accessibleName(byRole(steps[3]!, 'img'))).toBe(
      `Finishes by week, with ${half?.percent}% done by week ${half?.period} and ${sure?.percent}% by week ${sure?.period}.`,
    )
  })

  test('the few simulations after the graph’s last week, in one line under the burndown', () => {
    expect(text(byRole(page, 'region', { name: 'The problem' }))).toMatch(/ of simulations finish later, the last in week \d+\./)
  })
})
