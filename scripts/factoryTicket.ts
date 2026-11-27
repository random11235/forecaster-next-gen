// What the factory (.github/workflows/factory.yml) says about a ticket: the prompt it gives its agent, `/implement <n>`,
// then the factory's rules for an unattended run, then the ticket's text, which a workflow step fetched, so the agent
// needs no GitHub token. The rules are the factory's contract with its agent, so `/implement` stays upstream's copy:
// they name no file or rule of the repo's, only the check command, and send the agent to the repo's own rules through
// `AGENTS.md`. The repo is public, so
// anyone can comment on a ticket: only the text the owner and collaborators wrote reaches the prompt, and not the factory's
// own comments, save triage's brief (scripts/factoryTrust.ts).

import { byFactory, isTrusted, triageBrief, type Authored } from './factoryTrust.ts'

export type { Authored }

/** A ticket as GitHub's REST API gives it (`gh api repos/<o>/<r>/issues/<n>`), the fields the prompt reads. */
export type Ticket = Authored & { number: number; title: string }

/** An issue's title and body, if the owner or a collaborator opened it, or a line saying they're left out. */
export const titleAndBody = (issue: Ticket, kind: 'ticket' | 'spec'): string[] =>
  isTrusted(issue.author_association)
    ? [`# ${issue.title}`, '', issue.body ?? '']
    : [`(The ${kind}'s own title and body are left out: @${issue.user.login}, who opened it, isn't the owner or a collaborator.)`]

/**
 * The factory's rules for an unattended run, in place of what `/implement` says about fetching the ticket and asking,
 * with `check` the command the factory runs on the agent's commits.
 */
const factoryRules = (check: string): string[] => [
  '<factory-rules>',
  'The factory is running you, and nobody is there to answer. These rules take the place of what `/implement` says about fetching the ticket and asking.',
  '',
  '- Build from the `<ticket>` block below, and make no call to GitHub at all, read or write: no `gh`, no labels or comments, no issues or PRs, no push. You hold no GitHub token: the factory does those itself.',
  "- A `<spec>` block after the ticket holds the spec it is part of, for context: build only the ticket. Your commits are merged into the spec's branch, where earlier tickets' code already is.",
  '- Where you would ask, choose the reading of the ticket that changes least, and say so in your commit message.',
  '- Give `code-review` the `<ticket>` block as the ticket to review against.',
  `- The factory runs \`${check}\` on your commits and opens no PR if it fails, so whatever that check requires must be in them. The repo's rules, which you reach through \`AGENTS.md\`, say what it requires.`,
  "- Commit everything you change: the factory doesn't open a PR from a tree left dirty.",
  "- End your reply with the PR's body, written with the `pr` skill, in a `<pr-body>` block. The factory opens the PR with it and adds the line closing the ticket itself.",
  '</factory-rules>',
]

/**
 * `/implement <n>`, then the factory's rules, then the ticket's text in a `<ticket>` block: its title and body, if the owner or a collaborator
 * opened it, triage's brief, whoever opened it, and the owner's and collaborators' comments, leaving out the factory's.
 * A spec's ticket is followed by the spec's title and body, on the same terms, in a `<spec>` block.
 */
export function ticketPrompt(ticket: Ticket, comments: readonly Authored[], check: string, spec?: Ticket): string {
  const trustedComments = comments
    .filter((each) => isTrusted(each.author_association) && !byFactory(each.body))
    .map(({ user, body }) => `\n## Comment by @${user.login}\n\n${body ?? ''}`)
  const brief = triageBrief(comments)
  const briefSection = brief === undefined ? [] : ['', "## Triage's brief", '', brief]
  const specBlock = spec ? ['', `<spec number="${spec.number}">`, ...titleAndBody(spec, 'spec'), '</spec>'] : []
  return [
    `/implement ${ticket.number}`,
    '',
    ...factoryRules(check),
    '',
    `<ticket number="${ticket.number}">`,
    ...titleAndBody(ticket, 'ticket'),
    ...briefSection,
    ...trustedComments,
    '</ticket>',
    ...specBlock,
  ].join('\n')
}
