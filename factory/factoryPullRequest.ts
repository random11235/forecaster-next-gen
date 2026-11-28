// The body of the PR the factory (.github/workflows/factory.yml) opens for a ticket: the agent's, which it wrote with
// `/pr` (docs/agents/pull-requests.md), then the line closing the ticket, which the factory adds itself.

/**
 * The PR's body: the one the agent wrote with `/pr` and ended its reply with, in a `<pr-body>` block, then the line
 * closing ticket `issue` and the run that built it, which the factory adds itself. `check` is the command that passed.
 */
export function pullRequestBody(reply: string, issue: number, runUrl: string, check: string): string {
  const written = lastBlock(reply, 'pr-body')?.trim() || noBody(issue, runUrl, check)
  const closing = `\n\nCloses #${issue}.\n\nBuilt by the factory in run ${runUrl}.\n`
  const cut = `\n\n(The agent's body was cut here: it was ${written.length} characters, more than a PR body holds.)`
  const room = MAX_BODY - closing.length - cut.length
  return `${written.length + closing.length > MAX_BODY ? written.slice(0, room) + cut : written}${closing}`
}

/** What the reply's last `<tag>` block holds: the one it ends with, though it may name the tag before. */
export function lastBlock(reply: string, tag: string): string | undefined {
  const close = reply.lastIndexOf(`</${tag}>`)
  const open = reply.lastIndexOf(`<${tag}>`, close)
  return close === -1 || open === -1 ? undefined : reply.slice(open + `<${tag}>`.length, close)
}

/** The most characters GitHub takes in a PR body, or a comment. */
export const MAX_BODY = 65_536

/** A body in `/pr`'s sections for a PR whose agent wrote none. */
const noBody = (issue: number, runUrl: string, check: string): string =>
  [
    `## Summary\n\nThe factory built #${issue}, but its agent wrote no PR body: read the commits.`,
    `## Evidence\n\n\`${check}\` passed on the branch in run ${runUrl}.`,
    '## Merge Danger\n\nUnknown: with no body to say what changed, review the whole diff.',
  ].join('\n\n')
