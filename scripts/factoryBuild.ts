// The factory's build of one ticket (#336), run by .github/workflows/factory.yml once bwrap's probe has passed, on the
// branch the ticket is built on. It runs Claude Code in Sandcastle's bwrap() sandbox on `/implement <n>` with the
// ticket's text (scripts/factoryTicket.ts), and Sandcastle merges the agent's commits into that branch. A run that makes
// no commit fails. It pushes nothing and holds no GitHub token: the workflow's later jobs do every write to GitHub.
// Needs CLAUDE_CODE_OAUTH_TOKEN, and TICKET_JSON and COMMENTS_JSON: the files a step wrote the ticket and its comments
// to, from `gh api` (the comments with `--paginate --slurp`, so a list of pages).

import { appendFileSync, readFileSync } from 'node:fs'
import { run } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { factoryAgent } from './factoryAgent.ts'
import { ticketPrompt, type IssueComment, type Ticket } from './factoryTicket.ts'

const MODEL = 'opus'
/** Claude Code stops after the turn that passes this, so a stuck run can't spend without end. */
const MAX_BUDGET_USD = 25

const env = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const ticket = JSON.parse(readFileSync(env('TICKET_JSON'), 'utf8')) as Ticket
const comments = (JSON.parse(readFileSync(env('COMMENTS_JSON'), 'utf8')) as IssueComment[][]).flat()

const result = await run({
  name: `ticket-${ticket.number}`,
  prompt: ticketPrompt(ticket, comments),
  agent: factoryAgent(MODEL, { oauthToken: env('CLAUDE_CODE_OAUTH_TOKEN'), maxBudgetUsd: MAX_BUDGET_USD }),
  // the test suite runs for minutes, past Claude Code's 2-minute default for a Bash command
  sandbox: bwrap({ env: { BASH_DEFAULT_TIMEOUT_MS: '900000' } }),
  branchStrategy: { type: 'merge-to-head' },
  // the worktree holds only what git tracks: the dependencies, and the skills installed from skills-lock.json, are copied in
  copyToWorktree: ['node_modules', '.claude/skills'],
  timeouts: { copyToWorktreeMs: 600_000 },
  maxIterations: 1,
  idleTimeoutSeconds: 1200,
  logging: { type: 'stdout' },
})

const commits = result.commits.length
console.log(`The agent made ${commits} commit(s) on ${result.branch}.`)
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `commits=${commits}\n`)
if (commits === 0) {
  console.log('::error::The agent made no commit, so there is nothing to open a PR from.')
  process.exitCode = 1
}
