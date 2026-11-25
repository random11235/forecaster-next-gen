// What the factory (.github/workflows/factory.yml) says about a ticket: the prompt it gives its agent, `/implement <n>`
// then the ticket's text, which a workflow step fetched, so the agent needs no GitHub token. The repo is public, so
// anyone can comment on a ticket: only the text the owner and collaborators wrote reaches the prompt (ADR 0005, risk R2
// in docs/research/sandcastle-factory.md), and not the factory's own comments, which its token, maybe the owner's, makes.

/** GitHub's `author_association`: how the author of an issue or comment is related to the repo. */
export type Association = 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'FIRST_TIME_CONTRIBUTOR' | 'FIRST_TIMER' | 'MANNEQUIN' | 'NONE'

/** An issue's or a comment's text and author, as GitHub's REST API gives them. */
export type Authored = { body: string | null; user: { login: string }; author_association: Association }

/** A ticket as GitHub's REST API gives it (`gh api repos/<o>/<r>/issues/<n>`), the fields the prompt reads. */
export type Ticket = Authored & { number: number; title: string }

/** The authors whose text the agent is given: the owner, and the repo's collaborators. */
const TRUSTED: readonly Association[] = ['OWNER', 'MEMBER', 'COLLABORATOR']

/** The hidden mark every comment the factory makes carries, so its comments never reach a later prompt. */
export const FACTORY_MARK = '<!-- forecaster-factory -->'

const trusted = ({ author_association }: Authored): boolean => TRUSTED.includes(author_association)

const byFactory = ({ body }: Authored): boolean => (body ?? '').includes(FACTORY_MARK)

/**
 * `/implement <n>`, then the ticket's text in a `<ticket>` block: its title and body, if the owner or a collaborator
 * opened it, and their comments, leaving out the factory's.
 */
export function ticketPrompt(ticket: Ticket, comments: readonly Authored[]): string {
  const titleAndBody = trusted(ticket)
    ? [`# ${ticket.title}`, '', ticket.body ?? '']
    : [`(The ticket's own title and body are left out: @${ticket.user.login}, who opened it, isn't the owner or a collaborator.)`]
  const trustedComments = comments
    .filter((each) => trusted(each) && !byFactory(each))
    .map(({ user, body }) => `\n## Comment by @${user.login}\n\n${body ?? ''}`)
  return [`/implement ${ticket.number}`, '', `<ticket number="${ticket.number}">`, ...titleAndBody, ...trustedComments, '</ticket>'].join('\n')
}
