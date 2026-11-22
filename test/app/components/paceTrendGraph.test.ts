import { describe, expect, test } from 'vitest'
import { renderPaceTrend } from '../../../src/app/paceTrendGraph.js'
import type { PaceTrend, PairedPace, PeriodName } from '../../../src/forecast/index.js'
import { accessibleName, byRole, render, text } from '../dom.js'

// The pace trend graph (#236), rendered from a trend built by hand: what it says and draws for typed counts, and for
// the tracker's counts paired with comparable work's. Which trend a forecast has is Seam B's (test/forecast/).

const graph = (trend: PaceTrend | undefined, period: PeriodName = 'week') => render(renderPaceTrend(trend, period, '  '))
const typed = (counts: number[], start: number, end: number): PaceTrend => ({ counts, start, end, paired: undefined })
const paired = (pairing: PairedPace, start = 4, end = 6): PaceTrend => ({ counts: pairing[pairing.from], start, end, paired: pairing })
/** Each bar's height, in SVG units, drawn with `kind` (every bar without). */
const heights = (trend: PaceTrend, kind = 'rect') => [...graph(trend).querySelectorAll(`.trend-bars ${kind}`)].map((bar) => Number(bar.getAttribute('height')))

describe('the pace trend graph', () => {
  test('with no trend, draws nothing', () => {
    expect(renderPaceTrend(undefined, 'week', '  ')).toBe('')
  })

  test('typed counts: says them and the line’s two ends, to one decimal place', () => {
    const page = graph(typed([3, 5, 4, 6], 3.25, 5.5), 'sprint')

    expect(accessibleName(byRole(page, 'img'))).toBe(
      'Pace trend: typed counts of 3, 5, 4, 6, oldest first, with a straight line fitted through them from 3.3 to 5.5 tickets a sprint.',
    )
    expect(text(page)).toBe('Trend: 3.3 → 5.5 tickets a sprint, a straight line through 4 sprints, oldest first.')
  })

  test('typed counts: one bar each, the tallest the full height and the others to scale', () => {
    expect(heights(typed([2, 4, 1], 2, 3))).toEqual([32, 64, 16])
  })

  test('a line running below none or above the tallest count widens the scale to hold it', () => {
    // from -2 to 6: a count of 4 is half the height
    expect(heights(typed([4, 2], -2, 6))).toEqual([32, 16])
  })

  test('with no tickets done, the scale still has a height', () => {
    expect(heights(typed([0, 0], 0, 0))).toEqual([0, 0])
    expect(text(graph(typed([0, 0], 0, 0)))).toContain('Trend: 0 → 0 tickets a week')
  })

  describe('paired with comparable work', () => {
    const fromComparable: PairedPace = { from: 'comparableWork', comparableWork: [4, 6, 8], milestone: [1, 2, 3], beforeStart: 0 }
    const fromOwn: PairedPace = { from: 'milestone', comparableWork: [4, 6, 8, 2], milestone: [0, 0, 5, 7], beforeStart: 2 }

    test('pace from comparable work: says both series, marking comparable work’s as the pace', () => {
      const page = graph(paired(fromComparable))

      expect(accessibleName(byRole(page, 'img'))).toBe(
        "Pace trend, oldest first: comparable work's finished tickets each week, the pace, 4, 6, 8; the milestone's own, 1, 2, 3, with a straight line fitted through comparable work’s from 4 to 6 tickets a week.",
      )
      expect(text(page)).toBe(
        'Trend: 4 → 6 tickets a week, a straight line through comparable work’s 3 weeks, oldest first. comparable work, the pace the milestone’s own',
      )
    })

    test('pace from comparable work: two bars a period, comparable work’s drawn in use', () => {
      const trend = paired(fromComparable)

      expect(heights(trend, '.comparable.in-use')).toEqual([32, 48, 64])
      expect(heights(trend, '.own:not(.in-use)')).toEqual([8, 16, 24])
      expect(graph(trend).querySelector('pattern')).toBeNull()
    })

    test('pace from the milestone’s own: marks it the pace, and says the periods before it started', () => {
      const page = graph(paired(fromOwn, 0, 7))

      expect(accessibleName(byRole(page, 'img'))).toBe(
        "Pace trend, oldest first: comparable work's finished tickets each week, 4, 6, 8, 2; the milestone's own, the pace, not started, not started, 5, 7, with a straight line fitted through the milestone’s own from 0 to 7 tickets a week.",
      )
      expect(text(page)).toBe(
        'Trend: 0 → 7 tickets a week, a straight line through the milestone’s own 4 weeks, oldest first. comparable work the milestone’s own, the pace before it started',
      )
    })

    test('pace from the milestone’s own: a hatched stub for each period before it started, its own bars in use after', () => {
      const trend = paired(fromOwn, 0, 7)

      expect(heights(trend, '.before')).toEqual([6, 6])
      expect(heights(trend, '.own.in-use')).toEqual([40, 56])
      expect(heights(trend, '.comparable:not(.in-use)')).toEqual([32, 48, 64, 16])
      expect(graph(trend).querySelector('pattern#pace-trend-before')).not.toBeNull()
    })
  })
})
