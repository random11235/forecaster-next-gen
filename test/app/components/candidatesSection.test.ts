import { describe, expect, test } from 'vitest'
import { candidatesHtml } from '../../../src/app/candidatesSection.js'
import { COMPARABLE_WORK_STEP } from '../../../src/app/queryStepSection.js'
import type { Candidate, Candidates } from '../../../src/forecast/index.js'
import { accessibleName, all, allByRole, byRole, hasRole, one, postsTo, render, text } from '../dom.js'

// The Comparable work step's candidates (#236), rendered from candidates built by hand: none opened, grouped against the
// milestone's own or by median, with nothing finished, and failed. How each is read and grouped is Seam B's
// (test/forecast/candidates.test.ts).

const label = (name: string) => ({ kind: 'label', name, query: `label:${name}` }) as const
/** What a candidate read shows. */
type Read = Extract<Candidate, { read: unknown }>['read']
const read = (name: string, versus: Read['versus'], more: Partial<Read> = {}) =>
  ({
    choice: label(name),
    thisMilestone: false,
    read: {
      strip: { counts: [2, 4], starts: ['2026-10-26', '2026-11-02'] },
      median: 3,
      versus,
      finished: 12,
      weeks: 8,
      lastFinished: '2026-11-10',
      open: 5,
      ...more,
    },
  }) satisfies Candidate
const shown = (candidates: Candidates) => render(candidatesHtml(candidates, 'opening-1', COMPARABLE_WORK_STEP))

describe('the candidates', () => {
  test('none opened yet: says how to open one, and is kept in its opening for the script', () => {
    const page = shown({ groups: [], period: 'week' })

    expect(text(page)).toBe(
      'Candidates Open a candidate (its pace link), or type to narrow the list to 5 or fewer, to see how it runs against the milestone’s own.',
    )
    expect(one(page, '.candidates').getAttribute('data-opening')).toBe('opening-1')
    expect(hasRole(page, 'list')).toBe(false)
  })

  test('against the milestone’s own: each group headed, each candidate a button adding it, with its strip, pace and facts', () => {
    const page = shown({
      milestoneOwn: 3.25,
      period: 'week',
      groups: [
        { group: 'slower', candidates: [read('payments', { kind: 'slower', by: 1.25 })] },
        { group: 'aboutTheSame', candidates: [read('checkout', { kind: 'aboutTheSame' }, { adds: 3 })] },
        { group: 'faster', candidates: [read('search', { kind: 'faster', by: 2 })] },
      ],
    })

    expect(text(page)).toContain('Against the milestone’s own so far: 3.3 a week.')
    expect(allByRole(page, 'heading').map((heading) => text(heading))).toEqual([
      'Candidates',
      'Slower than the milestone',
      'About the same',
      'Faster than the milestone',
    ])
    expect(postsTo(byRole(page, 'button', { name: 'payments label' }))).toBe('/inputs/comparable-work/add#comparable-work')
    const items = allByRole(page, 'listitem')
    expect(items.map((item) => text(item))).toEqual([
      'payments label 3 a week ↓ 1.3 a week slower 12 finished · last finished 10 Nov · 5 open',
      'checkout label 3 a week about the same 12 finished · adds 3 · last finished 10 Nov · 5 open',
      'search label 3 a week ↑ 2 a week faster 12 finished · last finished 10 Nov · 5 open',
    ])
    expect(accessibleName(one(items[0]!, '.strip'))).toBe('Finished a week: 2, 4')
    expect(all(items[0]!, '.strip i').map((bar) => [bar.getAttribute('title'), bar.getAttribute('style')])).toEqual([
      ['week of 26 Oct: 2', 'height:50%'],
      ['week of 2 Nov: 4', 'height:100%'],
    ])
  })

  test('too few periods of the milestone’s own: listed by median, a pace without a comparison', () => {
    const page = shown({ period: 'sprint', groups: [{ group: 'byMedian', candidates: [read('payments', { kind: 'tooFewToCompare' })] }] })

    expect(text(page)).toContain('The milestone has too few sprints of its own to compare, so candidates are listed by median.')
    expect(text(byRole(page, 'heading', { name: 'By median a sprint' }))).toBe('By median a sprint')
    expect(text(byRole(page, 'listitem'))).toBe('payments label 3 a sprint 12 finished · last finished 10 Nov · 5 open')
  })

  test('nothing finished, the milestone itself, and one whose read failed', () => {
    const nothing = read('stale', { kind: 'tooFewToCompare' }, { finished: 0, strip: { counts: [0, 0], starts: ['2026-10-26', '2026-11-02'] } })
    const { lastFinished: _, ...noneFinished } = nothing.read
    const page = shown({
      period: 'week',
      groups: [
        { group: 'nothingFinished', candidates: [{ ...nothing, read: noneFinished, thisMilestone: true }] },
        { group: 'readFailed', candidates: [{ choice: label('broken'), thisMilestone: false, failure: 'GitHub didn’t answer.' }] },
      ],
    })

    expect(allByRole(page, 'listitem').map((item) => text(item))).toEqual([
      'stale label this milestone: counts its own too 0 finished · none finished in the last 8 weeks · 5 open',
      'broken label GitHub didn’t answer.',
    ])
    expect(postsTo(byRole(page, 'button', { name: 'broken label' }))).toBe('/inputs/comparable-work/add#comparable-work')
    expect(all(page, '.strip i').map((bar) => bar.getAttribute('style'))).toEqual(['height:0%', 'height:0%'])
  })
})
