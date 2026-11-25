import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { nextStep, stepOutputs, subIssuesOf, type SubIssue } from '../../scripts/factoryFrontier.ts'
import { FACTORY_MARK, type Association } from '../../scripts/factoryTrust.ts'

const SPEC = 9

const ticket = (number: number, more: Partial<SubIssue> = {}): SubIssue => ({
  number,
  state: 'OPEN',
  labels: { nodes: [] },
  blockedBy: { nodes: [] },
  comments: { nodes: [] },
  ...more,
})

const comment = (authorAssociation: Association, body: string) => ({ authorAssociation, body })

/** The factory's comment on a ticket it pushed to spec/9. */
const MERGED = comment('OWNER', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`)

describe("the factory's next step on a spec", () => {
  test('builds the first open ticket, in order', () => {
    expect(nextStep(SPEC, [ticket(12), ticket(13)])).toEqual({ action: 'build', ticket: 12 })
  })

  test("skips a closed ticket, and one the factory commented merged into the spec's branch", () => {
    const tickets = [
      ticket(10, { state: 'CLOSED' }),
      ticket(11, { comments: { nodes: [MERGED] } }),
      ticket(12, { comments: { nodes: [comment('COLLABORATOR', `${FACTORY_MARK}\nMerged into spec/${SPEC}: https://run`)] } }),
      ticket(13),
    ]

    expect(nextStep(SPEC, tickets)).toEqual({ action: 'build', ticket: 13 })
  })

  test("doesn't take merged from a comment without the factory's mark, a stranger's, another spec's, or one that only mentions merging", () => {
    const comments = [
      comment('OWNER', 'merged'),
      comment('OWNER', `merged into spec/${SPEC}`),
      comment('NONE', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`),
      comment('OWNER', `${FACTORY_MARK}\nmerged into spec/${SPEC}0: https://run`),
      comment('OWNER', `${FACTORY_MARK}\nmerged into spec/8: https://run`),
      comment('OWNER', `${FACTORY_MARK}\nNot merged into spec/${SPEC} yet.`),
      comment('OWNER', `merged into spec/${SPEC} ${FACTORY_MARK}`),
    ]

    expect(nextStep(SPEC, [ticket(12, { comments: { nodes: comments } })])).toEqual({ action: 'build', ticket: 12 })
  })

  test('skips a parked ticket, for the next one that can be built', () => {
    expect(nextStep(SPEC, [ticket(12, { labels: { nodes: [{ name: 'parked' }] } }), ticket(13)])).toEqual({ action: 'build', ticket: 13 })
  })

  test('skips a ticket with an open blocker, but not one whose blockers are closed or merged into the spec', () => {
    const tickets = [
      ticket(11, { comments: { nodes: [MERGED] } }),
      ticket(12, { blockedBy: { nodes: [blocker(99, 'OPEN')] } }),
      ticket(13, { blockedBy: { nodes: [blocker(12, 'OPEN')] } }),
      ticket(14, { blockedBy: { nodes: [blocker(11, 'OPEN'), blocker(98, 'CLOSED')] } }),
    ]

    expect(nextStep(SPEC, tickets)).toEqual({ action: 'build', ticket: 14 })
  })

  test('opens the PR to main once every ticket is closed or merged', () => {
    const tickets = [ticket(11, { state: 'CLOSED' }), ticket(12, { comments: { nodes: [MERGED] } })]

    expect(nextStep(SPEC, tickets)).toEqual({ action: 'open-pr' })
  })

  test('stops when every ticket left is parked or blocked, saying which and by what', () => {
    const tickets = [
      ticket(12, { labels: { nodes: [{ name: 'parked' }] } }),
      ticket(13, { blockedBy: { nodes: [blocker(12, 'OPEN')] } }),
      ticket(14, { blockedBy: { nodes: [blocker(12, 'OPEN'), blocker(99, 'OPEN')] } }),
    ]

    expect(nextStep(SPEC, tickets)).toEqual({
      action: 'stop',
      why: 'no ticket can be built: #12 is parked; #13 is blocked by #12; #14 is blocked by #12, #99',
    })
  })

  test('stops on a spec with no tickets', () => {
    expect(nextStep(SPEC, [])).toEqual({ action: 'stop', why: 'the spec has no tickets (sub-issues)' })
  })
})

describe("the spec's sub-issues, from what `gh api graphql` gave", () => {
  test("are the issue's subIssues nodes", () => {
    const response = { data: { repository: { issue: { subIssues: { nodes: [ticket(12)] } } } } }

    expect(subIssuesOf(response)).toEqual([ticket(12)])
  })

  test("throw GitHub's own errors, not a TypeError, when the query failed", () => {
    const response = { data: null, errors: [{ message: 'Could not resolve to an Issue with the number of 9.' }] }

    expect(() => subIssuesOf(response)).toThrow("GitHub refused the query for the spec's sub-issues: Could not resolve to an Issue with the number of 9.")
  })

  test('throw, saying so, when the response holds no sub-issues', () => {
    expect(() => subIssuesOf({ data: { repository: { issue: null } } })).toThrow("GitHub's response holds no sub-issues for the spec")
  })
})

test("the next step, as the gate's step outputs, names each one: action, and ticket or why", () => {
  expect(stepOutputs({ action: 'build', ticket: 12 })).toBe('action=build\nticket=12\n')
  expect(stepOutputs({ action: 'open-pr' })).toBe('action=open-pr\n')
  expect(stepOutputs({ action: 'stop', why: 'no ticket can be built: #12 is parked' })).toBe('action=stop\nwhy=no ticket can be built: #12 is parked\n')
})

const blocker = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, state })

test("the factory's workflow comments merged in words the frontier reads as merged into the spec's branch", () => {
  const workflow = readFileSync(new URL('../../.github/workflows/factory.yml', import.meta.url), 'utf8')
  const said = /--body "\$MARK\n\s*(merged[^"]*)"/.exec(workflow)?.[1]

  expect(said).toBeDefined()
  const body = `${FACTORY_MARK}\n${String(said).replaceAll('$BRANCH', `spec/${SPEC}`).replaceAll('$RUN_URL', 'https://run')}`
  expect(nextStep(SPEC, [ticket(12, { comments: { nodes: [comment('OWNER', body)] } })])).toEqual({ action: 'open-pr' })
})
