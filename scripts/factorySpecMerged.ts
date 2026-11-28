// What the factory (.github/workflows/factory.yml) does once a spec's PR merges (#339): its `close` job closes the spec
// and every one of its tickets, takes the workflow labels off them, and deletes spec/<n>. Closing keywords in the PR's
// body would stop at 10 issues, so the factory closes them itself, from the spec's sub-issues as GitHub's REST API lists
// them. scripts/factorySpecClose.ts hands it the event and the sub-issues.
//
// A spec's PR is one from this repo's own spec/<n> into the default branch: a fork's PR, and a ticket's PR into
// spec/<n>, close nothing. Its head being in this repo means someone with write access pushed it, so it is the factory's
// or the owner's.

/** A closed PR, as the `pull_request_target` event gives it: a deleted fork's head has no repo. */
export type ClosedPullRequest = {
  merged: boolean
  head: { ref: string; repo: { full_name: string } | null }
  base: { ref: string; repo: { full_name: string } }
}

/** A spec or one of its tickets, as GitHub's REST API gives it. */
export type Issue = { number: number; state: 'open' | 'closed'; labels: readonly { name: string }[] }

/** What to do to one issue: close it if it's open, and take these labels off. */
export type Closing = { number: number; close: boolean; unlabel: string[] }

/** The labels the Ticket lifecycle takes off an issue when it closes (docs/agents/issue-tracker.md). */
const WORKFLOW_LABELS = ['ready-for-agent', 'in-progress']

/** The spec whose PR merged, or undefined if the PR isn't a spec's from this repo into the default branch, or didn't merge. */
export function mergedSpec({ merged, head, base }: ClosedPullRequest, defaultBranch: string): number | undefined {
  const spec = /^spec\/([1-9]\d*)$/.exec(head.ref)
  if (!merged || !spec || head.repo?.full_name !== base.repo.full_name || base.ref !== defaultBranch) return undefined
  return Number(spec[1])
}

/** What closing the merged spec does to each ticket, in order, then the spec; undefined if it has no tickets, so is no spec. */
export function closingPlan(spec: Issue, tickets: readonly Issue[]): Closing[] | undefined {
  if (tickets.length === 0) return undefined
  return [...tickets, spec]
    .map(({ number, state, labels }) => ({
      number,
      close: state === 'open',
      unlabel: WORKFLOW_LABELS.filter((label) => labels.some(({ name }) => name === label)),
    }))
    .filter(({ close, unlabel }) => close || unlabel.length > 0)
}

/** The plan as the workflow reads it: a line per issue, its number, `close` or `keep`, then its labels to take off, or `-`. */
export const closingLines = (plan: readonly Closing[]): string =>
  plan.map(({ number, close, unlabel }) => `${number} ${close ? 'close' : 'keep'} ${unlabel.join(',') || '-'}\n`).join('')
