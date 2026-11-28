// What the factory (.github/workflows/factory.yml) says about a ticket: the prompt it gives its agent, `/implement <n>`
// then the ticket's text, which a workflow step fetched, so the agent needs no GitHub token. The repo is public, so
// anyone can comment on a ticket: only the text the owner and collaborators wrote reaches the prompt, and not the factory's
// own comments, save triage's brief (scripts/factoryTrust.ts). A spec's ticket gets the spec too, with its decision log
// (scripts/factoryDecisionLog.ts), but none of the spec's other comments.

import { decisionLogBlock } from './factoryDecisionLog.ts'
import { fitted } from './factoryShell.ts'
import { byFactory, decisionLog, isTrusted, triageBrief, type Authored } from './factoryTrust.ts'

export type { Authored }

/** A ticket as GitHub's REST API gives it (`gh api repos/<o>/<r>/issues/<n>`), the fields the prompt reads. */
export type Ticket = Authored & { number: number; title: string }

/** The spec a ticket is part of, and the spec's comments, which hold its decision log, as GitHub's REST API gives them. */
export type Spec = { issue: Ticket; comments: readonly Authored[] }

/** An issue's title and body, if the owner or a collaborator opened it, or a line saying they're left out. */
export const titleAndBody = (issue: Ticket, kind: 'ticket' | 'spec'): string[] =>
  isTrusted(issue.author_association)
    ? [`# ${issue.title}`, '', issue.body ?? '']
    : [`(The ${kind}'s own title and body are left out: @${issue.user.login}, who opened it, isn't the owner or a collaborator.)`]

/**
 * `/implement <n>`, then the ticket's text in a `<ticket>` block: its title and body, if the owner or a collaborator
 * opened it, triage's brief, whoever opened it, and the owner's and collaborators' comments, leaving out the factory's.
 * A spec's ticket is followed by the spec's title and body, on the same terms, and its decision log, oldest first, in a
 * `<spec>` block. Too long for a command line, it leaves out the log's oldest entries, saying how many.
 */
export function ticketPrompt(ticket: Ticket, comments: readonly Authored[], spec?: Spec): string {
  const trustedComments = comments
    .filter((each) => isTrusted(each.author_association) && !byFactory(each.body))
    .map(({ user, body }) => `\n## Comment by @${user.login}\n\n${body ?? ''}`)
  const brief = triageBrief(comments)
  const briefSection = brief === undefined ? [] : ['', "## Triage's brief", '', brief]
  const log = spec ? decisionLog(spec.comments) : []
  const specBlock = (dropped: number) =>
    spec ? ['', `<spec number="${spec.issue.number}">`, ...titleAndBody(spec.issue, 'spec'), ...decisionLogBlock(log, dropped), '</spec>'] : []
  const prompt = (dropped: number) =>
    [
      `/implement ${ticket.number}`,
      '',
      `<ticket number="${ticket.number}">`,
      ...titleAndBody(ticket, 'ticket'),
      ...briefSection,
      ...trustedComments,
      '</ticket>',
      ...specBlock(dropped),
    ].join('\n')
  return fitted(prompt, log.length)
}
