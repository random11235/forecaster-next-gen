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

/**
 * The PR's body: the one the agent wrote with `/pr` and ended its reply with, in a `<pr-body>` block, then the line
 * closing ticket `issue` and the run that built it, which the factory adds itself.
 */
export function pullRequestBody(reply: string, issue: number, runUrl: string): string {
  const written = /<pr-body>([\s\S]*)<\/pr-body>/.exec(reply)?.[1]?.trim() || noBody(issue, runUrl)
  const closing = `\n\nCloses #${issue}.\n\nBuilt by the factory in run ${runUrl}.\n`
  const cut = `\n\n(The agent's body was cut here: it was ${written.length} characters, more than a PR body holds.)`
  const room = MAX_BODY - closing.length - cut.length
  return `${written.length + closing.length > MAX_BODY ? written.slice(0, room) + cut : written}${closing}`
}

/** The most characters GitHub takes in a PR body. */
const MAX_BODY = 65_536

/** A body in `/pr`'s sections for a PR whose agent wrote none. */
const noBody = (issue: number, runUrl: string): string =>
  [
    `## Summary\n\nThe factory built #${issue}, but its agent wrote no PR body: read the commits.`,
    `## Evidence\n\n\`npm run check\` passed on the branch in run ${runUrl}.`,
    '## Merge Danger\n\nUnknown: with no body to say what changed, review the whole diff.',
  ].join('\n\n')
