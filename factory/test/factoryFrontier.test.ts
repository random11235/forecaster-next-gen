import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import type { FactoryConfig } from '../factoryConfig.ts'
import { nextStep as frontierStep, stepOutputs, subIssuesOf, type SubIssue } from '../factoryFrontier.ts'
import type { Association, Author } from '../factoryTrust.ts'
import { DEFAULTS } from './workflowConfig.ts'

const FACTORY_MARK = DEFAULTS.mark

/** The spec's next step, with the workflow's default labels and mark unless the case gives its own. */
const nextStep = (spec: number, subIssues: readonly SubIssue[], hop = 0, config: FactoryConfig = DEFAULTS) => frontierStep(spec, subIssues, hop, config)

const SPEC = 9

const ticket = (number: number, more: Partial<SubIssue> = {}): SubIssue => ({
  number,
  state: 'OPEN',
  labels: { nodes: [] },
  blockedBy: { nodes: [] },
  comments: { nodes: [] },
  ...more,
})

const OWNER: Author = { __typename: 'User', login: 'owner' }
/** Who writes with a workflow's GITHUB_TOKEN, as GitHub's GraphQL API names it. */
const ACTIONS: Author = { __typename: 'Bot', login: 'github-actions' }

const comment = (authorAssociation: Association, body: string, author: Author | null = OWNER) => ({ authorAssociation, author, body })

/** The factory's comment on a ticket it pushed to spec/9, by publish's GITHUB_TOKEN. */
const MERGED = comment('NONE', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`, ACTIONS)

describe("the factory's next step on a spec", () => {
  test('builds the first open ticket, in order', () => {
    expect(nextStep(SPEC, [ticket(12), ticket(13)])).toEqual({ action: 'build', ticket: 12 })
  })

  test("skips a closed ticket, and one the factory, or the owner or a collaborator by hand, commented merged into the spec's branch", () => {
    const tickets = [
      ticket(10, { state: 'CLOSED' }),
      ticket(11, { comments: { nodes: [MERGED] } }),
      ticket(12, { comments: { nodes: [comment('COLLABORATOR', `${FACTORY_MARK}\nMerged into spec/${SPEC}: https://run`)] } }),
      ticket(13),
    ]

    expect(nextStep(SPEC, tickets)).toEqual({ action: 'build', ticket: 13 })
  })

  test("doesn't take merged from a comment without the factory's mark, a stranger's or another bot's, another spec's, or one that only mentions merging", () => {
    const comments = [
      comment('OWNER', 'merged'),
      comment('OWNER', `merged into spec/${SPEC}`),
      comment('NONE', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`),
      comment('NONE', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`, { __typename: 'User', login: 'github-actions' }),
      comment('NONE', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`, { __typename: 'Bot', login: 'dependabot' }),
      comment('NONE', `${FACTORY_MARK}\nmerged into spec/${SPEC}: https://run`, null),
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

  test('skips a ticket for a human to build, for the next one that can be built', () => {
    expect(nextStep(SPEC, [ticket(12, { labels: { nodes: [{ name: 'ready-for-human' }] } }), ticket(13)])).toEqual({ action: 'build', ticket: 13 })
  })

  test("counts a ticket for a human done once it merged into the spec's branch by hand", () => {
    const merged = comment('OWNER', `${FACTORY_MARK}\nmerged into spec/${SPEC} by hand`)
    const tickets = [ticket(12, { labels: { nodes: [{ name: 'ready-for-human' }] }, comments: { nodes: [merged] } })]

    expect(nextStep(SPEC, tickets)).toEqual({ action: 'open-pr' })
  })

  test('stops when every ticket left is parked, for a human or blocked, saying which and by what', () => {
    const tickets = [
      ticket(12, { labels: { nodes: [{ name: 'parked' }] } }),
      ticket(13, { blockedBy: { nodes: [blocker(12, 'OPEN')] } }),
      ticket(14, { blockedBy: { nodes: [blocker(12, 'OPEN'), blocker(99, 'OPEN')] } }),
      ticket(15, { labels: { nodes: [{ name: 'ready-for-human' }] } }),
    ]

    expect(nextStep(SPEC, tickets)).toEqual({
      action: 'stop',
      why: 'no ticket can be built: #12 is parked; #13 is blocked by #12; #14 is blocked by #12, #99; #15 is for a human to build',
    })
  })

  describe('on a run the chain started, capped at one hop for each of its tickets', () => {
    const tickets = [ticket(12, { state: 'CLOSED' }), ticket(13, { comments: { nodes: [MERGED] } }), ticket(14)]

    test("builds below the cap, a spec's last hop too", () => {
      expect(nextStep(SPEC, tickets, 2)).toEqual({ action: 'build', ticket: 14 })
    })

    test('stops at the cap, though a ticket could be built, naming the cap and how to go on', () => {
      expect(nextStep(SPEC, tickets, 3)).toEqual({
        action: 'stop',
        why: 'its runs have chained 3 times, once for each of its 3 tickets: label the spec ready-for-agent to build on',
      })
    })

    test('lets a spec of more than 20 tickets chain once for each, with no fixed cap', () => {
      const many = Array.from({ length: 30 }, (_, at) => ticket(100 + at))

      expect(nextStep(SPEC, many, 29)).toEqual({ action: 'build', ticket: 100 })
      expect(nextStep(SPEC, many, 30)).toMatchObject({ action: 'stop' })
    })
  })

  test('reads the configured parked label and mark, and names the configured trigger label, not the defaults', () => {
    const config = { ...DEFAULTS, parkedLabel: 'on-hold', triggerLabel: 'agent-go', mark: '<!-- other-factory -->' }
    const tickets = [
      ticket(11, { comments: { nodes: [comment('NONE', `<!-- other-factory -->\nmerged into spec/${SPEC}: https://run`, ACTIONS)] } }),
      ticket(12, { labels: { nodes: [{ name: 'on-hold' }] } }),
      ticket(13, { labels: { nodes: [{ name: 'parked' }] }, comments: { nodes: [MERGED] } }),
    ]

    expect(nextStep(SPEC, tickets, 0, config)).toEqual({ action: 'build', ticket: 13 })
    expect(nextStep(SPEC, tickets, 3, config)).toEqual({
      action: 'stop',
      why: 'its runs have chained 3 times, once for each of its 3 tickets: label the spec agent-go to build on',
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
  expect(nextStep(SPEC, [ticket(12, { comments: { nodes: [comment('NONE', body, ACTIONS)] } })])).toEqual({ action: 'open-pr' })
})

test("the factory's workflow comments merged with its publish job's GITHUB_TOKEN, which may write to issues", () => {
  const workflow = readFileSync(new URL('../../.github/workflows/factory.yml', import.meta.url), 'utf8')
  const publish = /\n {2}publish:\n(?: {4}[^\n]*\n|\n)*/.exec(workflow)?.[0]
  const step = /- name: Comment merged on the spec's ticket\n(?:\s+[^-\s][^\n]*\n)*/.exec(workflow)?.[0]

  expect(publish).toMatch(/\n {4}permissions:\n(?: {6}[^\n]*\n)* {6}issues: write\b/)
  expect(step).toContain('GH_TOKEN: ${{ github.token }}')
  expect(step).not.toContain('secrets.')
})
