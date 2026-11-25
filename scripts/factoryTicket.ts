// The prompt the factory (.github/workflows/factory.yml) gives its agent for a ticket: `/implement <n>`, then the
// ticket's text, which a workflow step fetched, so the agent needs no GitHub token. The repo is public, so anyone can
// comment on a ticket: only the text the owner and collaborators wrote reaches the prompt (ADR 0005, risk R2 in
// docs/research/sandcastle-factory.md).

/** A ticket as GitHub's REST API gives it (`gh api repos/<o>/<r>/issues/<n>`), the fields the prompt reads. */
export type Ticket = { number: number; title: string; body: string | null; user: { login: string }; author_association: string }

/** A comment as GitHub's REST API gives it (`gh api repos/<o>/<r>/issues/<n>/comments`). */
export type IssueComment = { body: string | null; user: { login: string }; author_association: string }

/** The authors whose text the agent is given: the owner, and the repo's collaborators. */
const TRUSTED = ['OWNER', 'MEMBER', 'COLLABORATOR']

const trusted = ({ author_association }: { author_association: string }): boolean => TRUSTED.includes(author_association)

/**
 * `/implement <n>`, then the ticket's text in a `<ticket>` block: its title and body, if the owner or a collaborator
 * opened it, and their comments.
 */
export function ticketPrompt(ticket: Ticket, comments: readonly IssueComment[]): string {
  const own = trusted(ticket)
    ? [`# ${ticket.title}`, '', ticket.body ?? '']
    : [`(The ticket's own title and body are left out: @${ticket.user.login}, who opened it, isn't the owner or a collaborator.)`]
  const said = comments.filter(trusted).map(({ user, body }) => `\n## Comment by @${user.login}\n\n${body ?? ''}`)
  return [`/implement ${ticket.number}`, '', `<ticket number="${ticket.number}">`, ...own, ...said, '</ticket>'].join('\n')
}
