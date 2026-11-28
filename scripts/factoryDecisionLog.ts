// A spec's decision log (#402): what each of its tickets' builds decided, kept with the spec so its later agents can read
// it. When `publish` in .github/workflows/factory.yml merges a spec's ticket into spec/<n>, it comments on the spec the
// entry `build` wrote here, from the `<pr-body>` its agent ended with. A later ticket's prompt (scripts/factoryTicket.ts)
// and a question's (scripts/factoryQuestion.ts) give the entries, oldest first, in a `<decision-log>` block. Only an
// entry opening with DECISION_MARK that github-actions wrote counts (scripts/factoryTrust.ts).
//
// It imports no package, as scripts/factoryQuestion.ts imports it.

import { lastBlock, MAX_BODY } from './factoryPullRequest.ts'
import { DECISION_MARK, isTrusted, type Authored } from './factoryTrust.ts'

/** The section of a `/pr` body an entry leaves out: test output, not a decision. */
const EVIDENCE = /^## Evidence\s*$/

/**
 * The entry for a ticket merged into `branch`, as a comment on its spec: the mark, the ticket's number and title (if the
 * owner or a collaborator opened it), the run, then the `<pr-body>` the agent ended `reply` with, its Evidence left out
 * and its headings a level down, cut to fit a comment.
 */
export function decisionEntry(ticket: Authored & { number: number; title: string }, reply: string, branch: string, runUrl: string): string {
  const title = isTrusted(ticket.author_association) ? ` ${ticket.title}` : ''
  const opening = `${DECISION_MARK}\n## #${ticket.number}${title}\n\nMerged into ${branch} in ${runUrl}.\n\n`
  const written = decisions(lastBlock(reply, 'pr-body') ?? '')
  const said = written || "(The agent wrote no PR body: read the ticket's commits.)"
  const cut = `\n\n(The entry was cut here: the agent's body was ${said.length} characters, more than a comment holds.)\n`
  const room = MAX_BODY - opening.length - 1
  return opening + (said.length > room ? said.slice(0, MAX_BODY - opening.length - cut.length) + cut : `${said}\n`)
}

/** The body's sections but Evidence, each heading a level down, below the entry's own. */
function decisions(body: string): string {
  const kept: string[] = []
  let evidence = false
  for (const line of body.trim().split('\n')) {
    if (/^## /.test(line)) evidence = EVIDENCE.test(line)
    if (!evidence) kept.push(/^#{1,5} /.test(line) ? `#${line}` : line)
  }
  return kept.join('\n').trim()
}

/** The `<decision-log>` block a prompt gives, with its `dropped` oldest entries left out, saying how many; none if it's empty. */
export const decisionLogBlock = (entries: readonly string[], dropped: number): string[] =>
  entries.length === 0
    ? []
    : [
        '',
        '<decision-log>',
        ...(dropped ? [`(The ${dropped} oldest entries are left out, to fit the prompt.)`, ''] : []),
        entries.slice(dropped).join('\n\n'),
        '</decision-log>',
      ]
