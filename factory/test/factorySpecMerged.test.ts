import { describe, expect, test } from 'vitest'
import { closingLines, closingPlan, mergedSpec, type ClosedPullRequest, type Issue } from '../factorySpecMerged.ts'

const REPO = 'owner/forecaster'

const closed = (more: { merged?: boolean; head?: string; base?: string; from?: string | null } = {}): ClosedPullRequest => ({
  merged: more.merged ?? true,
  head: { ref: more.head ?? 'spec/40', repo: more.from === null ? null : { full_name: more.from ?? REPO } },
  base: { ref: more.base ?? 'main', repo: { full_name: REPO } },
})

describe('which spec a closed PR merged, if any', () => {
  test("names the spec of a merged PR from this repo's spec/<n> into the default branch", () => {
    expect(mergedSpec(closed(), 'main')).toBe(40)
  })

  test.each([
    ['closed unmerged', closed({ merged: false })],
    ['from a fork', closed({ from: 'stranger/forecaster' })],
    ['from a deleted fork', closed({ from: null })],
    ['a ticket merged into spec/<n>', closed({ head: 'agent/41-7', base: 'spec/40' })],
    ['into another branch', closed({ base: 'release' })],
    ['from a ticket branch', closed({ head: 'agent/41-7' })],
    ['from a branch only like a spec', closed({ head: 'spec/40-retry' })],
    ['from spec/0', closed({ head: 'spec/0' })],
  ])('names none for a PR %s', (_, pr) => {
    expect(mergedSpec(pr, 'main')).toBeUndefined()
  })
})

const issue = (number: number, more: Partial<Issue> = {}): Issue => ({ number, state: 'open', labels: [], ...more })
const labels = (...names: string[]) => names.map((name) => ({ name }))

describe("what closing a merged spec's PR does", () => {
  test('closes each open ticket, then the spec, taking ready-for-agent and in-progress off, and leaving other labels', () => {
    const tickets = [issue(41, { labels: labels('in-progress', 'bug') }), issue(42, { labels: labels('ready-for-agent') }), issue(43)]

    expect(closingPlan(issue(40, { labels: labels('ready-for-agent', 'epic') }), tickets)).toEqual([
      { number: 41, close: true, unlabel: ['in-progress'] },
      { number: 42, close: true, unlabel: ['ready-for-agent'] },
      { number: 43, close: true, unlabel: [] },
      { number: 40, close: true, unlabel: ['ready-for-agent'] },
    ])
  })

  test('only takes the labels off a closed ticket, and leaves out one with nothing to do', () => {
    const tickets = [issue(41, { state: 'closed', labels: labels('in-progress') }), issue(42, { state: 'closed' })]

    expect(closingPlan(issue(40), tickets)).toEqual([
      { number: 41, close: false, unlabel: ['in-progress'] },
      { number: 40, close: true, unlabel: [] },
    ])
  })

  test('closes every ticket of a spec with more than 10, as closing keywords would not', () => {
    const tickets = Array.from({ length: 120 }, (_, at) => issue(100 + at))

    expect(closingPlan(issue(40), tickets)?.filter(({ close }) => close)).toHaveLength(121)
  })

  test('does nothing for an issue with no tickets, as it is no spec', () => {
    expect(closingPlan(issue(40), [])).toBeUndefined()
  })

  test('writes one line per issue for the workflow to read: number, close or keep, then the labels or a dash', () => {
    const plan = [
      { number: 41, close: false, unlabel: ['ready-for-agent', 'in-progress'] },
      { number: 40, close: true, unlabel: [] },
    ]

    expect(closingLines(plan)).toBe('41 keep ready-for-agent,in-progress\n40 close -\n')
  })
})
