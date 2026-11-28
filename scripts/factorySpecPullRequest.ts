// The PR the factory (.github/workflows/factory.yml) opens from spec/<n> to the default branch once every ticket of
// the spec is in (#339), when scripts/factoryFrontier.ts says `open-pr`. Its body follows docs/agents/pull-requests.md
// as far as a generated one can: a Summary opening with every ticket in a table, the spec's decision log
// (scripts/factoryDecisionLog.ts) for what each ticket decided, then Evidence and Merge Danger. It uses no closing
// keyword, and puts each one the log's entries hold in a code span with the issue it names: they stop at 10 issues,
// so the factory's `close` job closes the spec and its tickets once it merges (scripts/factorySpecMerged.ts). scripts/factorySpecOpen.ts hands it the spec, its sub-issues and its comments.

import { MAX_BODY } from './factoryPullRequest.ts'
import { decisionLog, isTrusted, type Association, type Authored } from './factoryTrust.ts'

/** The spec or one of its tickets, as GitHub's REST API gives it. */
export type SpecTicket = { number: number; title: string; state: 'open' | 'closed'; author_association: Association }

/** The PR's title and body, for spec `spec` with its tickets in order, its comments, and the run opening it. */
export function specPullRequest(
  spec: SpecTicket,
  tickets: readonly SpecTicket[],
  comments: readonly Authored[],
  runUrl: string,
): { title: string; body: string } {
  const branch = `spec/${spec.number}`
  const rows = tickets.map((ticket) => {
    const status = ticket.state === 'closed' ? 'closed' : `merged into ${branch}`
    return `| #${ticket.number} | ${titleOf(ticket)?.replaceAll('|', '\\|') ?? '(opened outside the repo: read the ticket)'} | ${status} |`
  })
  const summary = [
    `## Summary\n\nThe factory built spec #${spec.number}'s tickets on \`${branch}\`, in order:\n`,
    ['| Ticket | What it delivers | Status |', '| --- | --- | --- |', ...rows].join('\n'),
  ].join('\n')
  const after = [
    '## Evidence',
    `Each ticket's \`npm run check\` passed on \`${branch}\` with its commits, in the run its decision-log entry names. CI runs on this PR.`,
    '## Merge Danger',
    `Review the spec as a whole: its tickets merged into \`${branch}\` without a PR each. ` +
      `Once it merges, the factory closes spec #${spec.number} and its ${tickets.length} tickets, and deletes \`${branch}\`, ` +
      'as closing keywords stop at 10 issues.',
    `Opened by the factory in run ${runUrl}.\n`,
  ].join('\n\n')
  const room = MAX_BODY - summary.length - after.length - 4
  return { title: titleOf(spec) ?? `Spec #${spec.number}`, body: [summary, logSection(spec.number, comments, room), after].filter(Boolean).join('\n\n') }
}

/** The title, if the owner or a collaborator opened the issue: anyone else's could say anything. */
const titleOf = ({ title, author_association }: SpecTicket): string | undefined => (isTrusted(author_association) ? title : undefined)

/**
 * A fenced block, an inline code span, or a closing keyword and the issue it names (`#n`, `owner/repo#n` or a URL), as an
 * agent's body may hold one: merging the PR would close that issue, even one outside the spec.
 */
const CODE_OR_CLOSING =
  /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1[ \t]*$|(?![\s\S]))|(`+)[\s\S]*?\2(?!`)|\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+(?:[\w.-]+\/[\w.-]+#\d+|#\d+|https?:\/\/[^\s`]*\/\d+)/gim

/** The text with each closing keyword and the issue it names put in one code span, leaving its code spans and fences as they are. */
const defused = (text: string): string =>
  text.replace(CODE_OR_CLOSING, (match: string, fence?: string, span?: string) => ((fence ?? span) ? match : `\`${match}\``))

/** The spec's decision log as the body's section, its headings a level down, keeping the oldest entries that fit `room`. */
function logSection(spec: number, comments: readonly Authored[], room: number): string {
  const entries = decisionLog(comments).map((entry) => defused(entry.replace(/^(#{1,5}) /gm, '#$1 ')))
  if (entries.length === 0) return ''
  const opening = `## Decision log\n\nWhat each ticket decided, as its build wrote it on #${spec}.`
  const note = (left: number) => `(The log's ${left} latest entries are left out, to fit a PR body: read them on #${spec}.)`
  let kept = entries.length
  const text = (count: number) => [opening, ...entries.slice(0, count), ...(count < entries.length ? [note(entries.length - count)] : [])].join('\n\n')
  while (kept > 0 && text(kept).length > room) kept -= 1
  return text(kept)
}
