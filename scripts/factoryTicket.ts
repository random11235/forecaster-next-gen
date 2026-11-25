// What the factory (.github/workflows/factory.yml) says about a ticket: the prompt it gives its agent, `/implement <n>`
// then the ticket's text, which a workflow step fetched, so the agent needs no GitHub token. The repo is public, so
// anyone can comment on a ticket: only the text the owner and collaborators wrote reaches the prompt, and not the factory's
// own comments (scripts/factoryTrust.ts).

import { byFactory, isTrusted, type Association } from './factoryTrust.ts'

/** An issue's or a comment's text and author, as GitHub's REST API gives them. */
export type Authored = { body: string | null; user: { login: string }; author_association: Association }

/** A ticket as GitHub's REST API gives it (`gh api repos/<o>/<r>/issues/<n>`), the fields the prompt reads. */
export type Ticket = Authored & { number: number; title: string }

const trusted = ({ author_association }: Authored): boolean => isTrusted(author_association)

/** An issue's title and body, if the owner or a collaborator opened it, or a line saying they're left out. */
const titleAndBody = (issue: Ticket, kind: 'ticket' | 'spec'): string[] =>
  trusted(issue)
    ? [`# ${issue.title}`, '', issue.body ?? '']
    : [`(The ${kind}'s own title and body are left out: @${issue.user.login}, who opened it, isn't the owner or a collaborator.)`]

/**
 * `/implement <n>`, then the ticket's text in a `<ticket>` block: its title and body, if the owner or a collaborator
 * opened it, and their comments, leaving out the factory's. A spec's ticket is followed by the spec's title and body, on
 * the same terms, in a `<spec>` block.
 */
export function ticketPrompt(ticket: Ticket, comments: readonly Authored[], spec?: Ticket): string {
  const trustedComments = comments
    .filter((each) => trusted(each) && !byFactory(each.body))
    .map(({ user, body }) => `\n## Comment by @${user.login}\n\n${body ?? ''}`)
  const specBlock = spec ? ['', `<spec number="${spec.number}">`, ...titleAndBody(spec, 'spec'), '</spec>'] : []
  return [
    `/implement ${ticket.number}`,
    '',
    `<ticket number="${ticket.number}">`,
    ...titleAndBody(ticket, 'ticket'),
    ...trustedComments,
    '</ticket>',
    ...specBlock,
  ].join('\n')
}
