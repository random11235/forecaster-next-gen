// The PR the factory (.github/workflows/factory.yml) opens from spec/<n> to the default branch once every ticket of
// the spec is in (#339), when factory/factoryFrontier.ts says `open-pr`. Its body follows docs/agents/pull-requests.md
// as far as a generated one can: a Summary opening with every ticket in a table and pointing to the spec's decision log
// (factory/factoryDecisionLog.ts), in its comments, for what each ticket decided, then Evidence and Merge Danger. It
// uses no closing keyword: they stop at 10 issues, so the factory's `close` job closes the spec and its tickets once it
// merges (factory/factorySpecMerged.ts). factory/factorySpecOpen.ts hands it the spec and its sub-issues.

import { isTrusted, type Association } from './factoryTrust.ts'

/** The spec or one of its tickets, as GitHub's REST API gives it. */
export type SpecTicket = { number: number; title: string; state: 'open' | 'closed'; author_association: Association }

/** The PR's title and body, for spec `spec` with its tickets in order, and the run opening it. */
export function specPullRequest(spec: SpecTicket, tickets: readonly SpecTicket[], runUrl: string): { title: string; body: string } {
  const branch = `spec/${spec.number}`
  const rows = tickets.map((ticket) => {
    const status = ticket.state === 'closed' ? 'closed' : `merged into ${branch}`
    return `| #${ticket.number} | ${titleOf(ticket)?.replaceAll('|', '\\|') ?? '(opened outside the repo: read the ticket)'} | ${status} |`
  })
  const body = [
    [
      `## Summary\n\nThe factory built spec #${spec.number}'s tickets on \`${branch}\`, in order:\n`,
      ['| Ticket | What it delivers | Status |', '| --- | --- | --- |', ...rows].join('\n'),
    ].join('\n'),
    `What each ticket decided is in spec #${spec.number}'s decision log, in its comments.`,
    '## Evidence',
    `Each ticket's \`npm run check\` passed on \`${branch}\` with its commits, in the run its decision-log entry names. CI runs on this PR.`,
    '## Merge Danger',
    `Review the spec as a whole: its tickets merged into \`${branch}\` without a PR each. ` +
      `Once it merges, the factory closes spec #${spec.number} and its ${tickets.length} tickets, and deletes \`${branch}\`, ` +
      'as closing keywords stop at 10 issues.',
    `Opened by the factory in run ${runUrl}.\n`,
  ].join('\n\n')
  return { title: titleOf(spec) ?? `Spec #${spec.number}`, body }
}

/** The title, if the owner or a collaborator opened the issue: anyone else's could say anything. */
const titleOf = ({ title, author_association }: SpecTicket): string | undefined => (isTrusted(author_association) ? title : undefined)
