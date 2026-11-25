import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { nextStep, type SubIssue } from '../../scripts/factoryFrontier.ts'
import { FACTORY_MARK } from '../../scripts/factoryTicket.ts'

const ticket = (number: number, more: Partial<SubIssue> = {}): SubIssue => ({
  number,
  state: 'OPEN',
  labels: { nodes: [] },
  blockedBy: { nodes: [] },
  comments: { nodes: [] },
  ...more,
})

describe("the factory's next step on a spec", () => {
  test('builds the first open ticket, in order', () => {
    expect(nextStep([ticket(12), ticket(13)])).toEqual({ action: 'build', ticket: 12 })
  })

  test("skips a closed ticket, and one commented merged by the owner or a collaborator, the factory's marked comment among them", () => {
    const steps = [
      ticket(10, { state: 'CLOSED' }),
      ticket(11, { comments: { nodes: [merged('OWNER', 'merged')] } }),
      ticket(12, { comments: { nodes: [merged('COLLABORATOR', `${FACTORY_MARK}\nMerged into spec/9: https://run`)] } }),
      ticket(13),
    ]

    expect(nextStep(steps)).toEqual({ action: 'build', ticket: 13 })
  })

  test("doesn't take a stranger's merged comment, nor a comment that only mentions merging", () => {
    const comments = [merged('NONE', 'merged'), merged('OWNER', 'Not merged yet.'), merged('OWNER', 'mergedish')]

    expect(nextStep([ticket(12, { comments: { nodes: comments } })])).toEqual({ action: 'build', ticket: 12 })
  })

  test('skips a parked ticket, for the next one that can be built', () => {
    expect(nextStep([ticket(12, { labels: { nodes: [{ name: 'parked' }] } }), ticket(13)])).toEqual({ action: 'build', ticket: 13 })
  })

  test('skips a ticket with an open blocker, but not one whose blockers are closed or merged into the spec', () => {
    const steps = [
      ticket(11, { comments: { nodes: [merged('OWNER', 'merged')] } }),
      ticket(12, { blockedBy: { nodes: [blocker(99, 'OPEN')] } }),
      ticket(13, { blockedBy: { nodes: [blocker(12, 'OPEN')] } }),
      ticket(14, { blockedBy: { nodes: [blocker(11, 'OPEN'), blocker(98, 'CLOSED')] } }),
    ]

    expect(nextStep(steps)).toEqual({ action: 'build', ticket: 14 })
  })

  test('opens the PR to main once every ticket is closed or merged', () => {
    const steps = [ticket(11, { state: 'CLOSED' }), ticket(12, { comments: { nodes: [merged('OWNER', 'merged')] } })]

    expect(nextStep(steps)).toEqual({ action: 'open-pr' })
  })

  test('stops when every ticket left is parked or blocked, saying which and by what', () => {
    const steps = [
      ticket(12, { labels: { nodes: [{ name: 'parked' }] } }),
      ticket(13, { blockedBy: { nodes: [blocker(12, 'OPEN')] } }),
      ticket(14, { blockedBy: { nodes: [blocker(12, 'OPEN'), blocker(99, 'OPEN')] } }),
    ]

    expect(nextStep(steps)).toEqual({ action: 'stop', why: 'no ticket can be built: #12 is parked; #13 is blocked by #12; #14 is blocked by #12, #99' })
  })

  test('stops on a spec with no tickets', () => {
    expect(nextStep([])).toEqual({ action: 'stop', why: 'the spec has no tickets (sub-issues)' })
  })
})

const blocker = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, state })

const merged = (authorAssociation: string, body: string) => ({ authorAssociation, body })

test("the factory's workflow comments merged in words the frontier reads as merged", () => {
  const workflow = readFileSync(new URL('../../.github/workflows/factory.yml', import.meta.url), 'utf8')
  const said = /--body "\$MARK\n\s*(merged[^"]*)"/.exec(workflow)?.[1]

  expect(said).toBeDefined()
  const body = `${FACTORY_MARK}\n${String(said)}`
  expect(nextStep([ticket(12, { comments: { nodes: [merged('OWNER', body)] } })])).toEqual({ action: 'open-pr' })
})
