// What the factory (.github/workflows/factory.yml) does next on a spec labelled `ready-for-agent` (#337): build its
// next ticket on spec/<n>, open the spec's PR to main once every ticket is in, or stop, saying why. Pure: a workflow step
// fetches the spec's sub-issues with `gh api graphql` and scripts/factoryNext.ts hands them over.
//
// The next ticket is the first of the spec's sub-issues, in their order, that is neither done, nor parked, nor blocked.
// A ticket is done once closed, or once it merged into spec/<n>, which leaves it open (it closes with the spec's PR):
// that is a comment saying `merged`, by the owner or a collaborator, as /implement-spec writes locally and the factory
// writes with its mark. A blocker counts while it is open and not merged into spec/<n>, as the ticket built on it then
// has its code. A parked ticket waits for the owner, who takes the label off.

import { FACTORY_MARK, TRUSTED, type Association } from './factoryTicket.ts'

type State = 'OPEN' | 'CLOSED'

/** One of a spec's sub-issues, as GitHub's GraphQL API gives it. */
export type SubIssue = {
  number: number
  state: State
  labels: { nodes: readonly { name: string }[] }
  blockedBy: { nodes: readonly { number: number; state: State }[] }
  comments: { nodes: readonly { body: string; authorAssociation: string }[] }
}

export type Next = { action: 'build'; ticket: number } | { action: 'open-pr' } | { action: 'stop'; why: string }

type Comment = SubIssue['comments']['nodes'][number]

/** A comment whose first word is `merged`, by the owner or a collaborator; the factory's mark before it is allowed. */
const saysMerged = ({ body, authorAssociation }: Comment): boolean =>
  TRUSTED.includes(authorAssociation as Association) && /^merged\b/i.test(body.replace(FACTORY_MARK, '').trim())

const done = (ticket: SubIssue): boolean => ticket.state === 'CLOSED' || ticket.comments.nodes.some(saysMerged)

const parked = ({ labels }: SubIssue): boolean => labels.nodes.some(({ name }) => name === 'parked')

const list = (numbers: readonly number[]): string => numbers.map((number) => `#${number}`).join(', ')

/** The spec's next step, given its sub-issues in order. */
export function nextStep(subIssues: readonly SubIssue[]): Next {
  if (subIssues.length === 0) return { action: 'stop', why: 'the spec has no tickets (sub-issues)' }
  const merged = new Set(subIssues.filter(done).map(({ number }) => number))
  const left = subIssues.filter(({ number }) => !merged.has(number))
  if (left.length === 0) return { action: 'open-pr' }
  const blockers = ({ blockedBy }: SubIssue): number[] =>
    blockedBy.nodes.filter(({ number, state }) => state === 'OPEN' && !merged.has(number)).map(({ number }) => number)
  const ticket = left.find((each) => !parked(each) && blockers(each).length === 0)
  if (ticket) return { action: 'build', ticket: ticket.number }
  const why = left.map((each) => (parked(each) ? `#${each.number} is parked` : `#${each.number} is blocked by ${list(blockers(each))}`))
  return { action: 'stop', why: `no ticket can be built: ${why.join('; ')}` }
}
