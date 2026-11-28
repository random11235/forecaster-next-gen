// What the factory (.github/workflows/factory.yml) does next on a spec labelled with its trigger label (#337): build its
// next ticket on spec/<n>, open the spec's PR to main once every ticket is in, or stop, saying why. A workflow step
// fetches the spec's sub-issues with `gh api graphql` and factory/factoryNext.ts hands them over.
//
// The next ticket is the first of the spec's sub-issues, in their order, that is neither done, nor parked, nor for a
// human, nor blocked. A ticket is done once closed, or once it merged into spec/<n>, which leaves it open (it closes
// with the spec's PR): that is the factory's comment `merged into spec/<n>`, which opens with its mark and is by the
// factory's github-actions bot, or by the owner or a collaborator by hand (factory/factoryTrust.ts). A blocker counts
// while it is open and not merged into spec/<n>, as the ticket built on it then has its code. A parked ticket waits for
// the owner, who takes the label off. A `ready-for-human` ticket waits for a person to build it locally and comment it
// merged by hand.
//
// After a ticket merges, the factory starts its own next run on the spec (#338), one hop further along the chain; the
// run its label started is hop 0. Each hop builds one ticket, so a chain needs at most one hop per sub-issue: at the
// spec's number of sub-issues it stops rather than build, so a bug that keeps picking the same ticket can't rebuild it
// past that (R5 in docs/research/sandcastle-factory.md). Labelling the spec again starts a new chain at hop 0.

import type { FactoryConfig } from './factoryConfig.ts'
import { factoryWords, isActionsBot, isTrusted, type Association, type Author } from './factoryTrust.ts'

type State = 'OPEN' | 'CLOSED'

/** One of a spec's sub-issues, as GitHub's GraphQL API gives it. */
export type SubIssue = {
  number: number
  state: State
  labels: { nodes: readonly { name: string }[] }
  blockedBy: { nodes: readonly { number: number; state: State }[] }
  comments: { nodes: readonly { body: string; authorAssociation: Association; author: Author | null }[] }
}

export type Next = { action: 'build'; ticket: number } | { action: 'open-pr' } | { action: 'stop'; why: string }

type Comment = SubIssue['comments']['nodes'][number]

/** What `gh api graphql` gave for the spec's sub-issues: the data, or GitHub's errors. */
export type SubIssuesResponse = {
  data?: { repository?: { issue?: { subIssues?: { nodes?: SubIssue[] } | null } | null } | null } | null
  errors?: readonly { message: string }[]
}

/** The spec's sub-issues, in order, from GitHub's response, or a throw saying why there are none. */
export function subIssuesOf(response: SubIssuesResponse): SubIssue[] {
  if (response.errors?.length) {
    throw new Error(`GitHub refused the query for the spec's sub-issues: ${response.errors.map(({ message }) => message).join('; ')}`)
  }
  const nodes = response.data?.repository?.issue?.subIssues?.nodes
  if (!nodes) throw new Error("GitHub's response holds no sub-issues for the spec")
  return nodes
}

/** The factory's comment, after its mark, saying the ticket merged into the spec's branch: the factory's, or by hand. */
const mergedInto =
  (spec: number, mark: string) =>
  ({ body, authorAssociation, author }: Comment): boolean =>
    (isActionsBot(author) || isTrusted(authorAssociation)) && new RegExp(`^merged into spec/${spec}\\b`, 'i').test(factoryWords(body, mark) ?? '')

const labelled =
  (label: string) =>
  ({ labels }: SubIssue): boolean =>
    labels.nodes.some(({ name }) => name === label)
const forAHuman = labelled('ready-for-human')

const list = (numbers: readonly number[]): string => numbers.map((number) => `#${number}`).join(', ')

/** The config's values the frontier reads: the factory's mark, the parked label, and the trigger label it names. */
export type FrontierConfig = Pick<FactoryConfig, 'mark' | 'parkedLabel' | 'triggerLabel'>

/** The spec's next step, given its number, its sub-issues in order, how many runs chained before this one, and the config. */
export function nextStep(spec: number, subIssues: readonly SubIssue[], hop: number, config: FrontierConfig): Next {
  if (subIssues.length === 0) return { action: 'stop', why: 'the spec has no tickets (sub-issues)' }
  const parked = labelled(config.parkedLabel)
  const isDone = (ticket: SubIssue): boolean => ticket.state === 'CLOSED' || ticket.comments.nodes.some(mergedInto(spec, config.mark))
  const done = new Set(subIssues.filter(isDone).map(({ number }) => number))
  const left = subIssues.filter(({ number }) => !done.has(number))
  if (left.length === 0) return { action: 'open-pr' }
  const blockers = ({ blockedBy }: SubIssue): number[] =>
    blockedBy.nodes.filter(({ number, state }) => state === 'OPEN' && !done.has(number)).map(({ number }) => number)
  const ticket = left.find((each) => !parked(each) && !forAHuman(each) && blockers(each).length === 0)
  const cap = subIssues.length
  if (ticket && hop >= cap) {
    const why = `its runs have chained ${cap} times, once for each of its ${cap} tickets: label the spec ${config.triggerLabel} to build on`
    return { action: 'stop', why }
  }
  if (ticket) return { action: 'build', ticket: ticket.number }
  const why = left.map((each) =>
    parked(each)
      ? `#${each.number} is parked`
      : forAHuman(each)
        ? `#${each.number} is for a human to build`
        : `#${each.number} is blocked by ${list(blockers(each))}`,
  )
  return { action: 'stop', why: `no ticket can be built: ${why.join('; ')}` }
}

/** The next step as the gate's step outputs, one `name=value` line each: `action`, then `ticket` or `why`. */
export function stepOutputs(next: Next): string {
  const lines = [`action=${next.action}`]
  if (next.action === 'build') lines.push(`ticket=${next.ticket}`)
  if (next.action === 'stop') lines.push(`why=${next.why}`)
  return `${lines.join('\n')}\n`
}
