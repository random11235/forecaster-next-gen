// The factory's build of one ticket (#336), run by .github/workflows/factory.yml once bwrap's probe has passed, on the
// branch the ticket is built on. It runs Claude Code in Sandcastle's bwrap() sandbox on `/implement <n>` with the
// ticket's text (scripts/factoryTicket.ts), and Sandcastle merges the agent's commits into that branch. It pushes
// nothing and holds no GitHub token: the workflow's later jobs check the commits and do every write to GitHub.
//
// It writes `result` to the step's outputs: `built`, `no-commits`, `dirty` (the agent left changes it didn't commit) or
// `error`; none at all means the step was stopped, by its timeout. Only `built` passes. Into LOG_DIR go the agent's
// stream-json as it comes (`transcript.jsonl`, so a stopped run keeps it), Sandcastle's log, and Claude Code's session;
// into OUT_DIR, the PR body. The other inputs are environment variables too: CLAUDE_CODE_OAUTH_TOKEN, TICKET_JSON,
// COMMENTS_JSON, BRANCH and RUN_URL.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, type AgentStreamEvent } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { factoryAgent } from './factoryAgent.ts'
import { pullRequestBody, ticketPrompt, type Authored, type Ticket } from './factoryTicket.ts'

const MODEL = 'opus'
/** Claude Code stops after the turn that passes this, so a stuck run can't spend without end. */
const MAX_BUDGET_USD = 25

const env = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const output = (line: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${line}\n`)
}

/** The build's result, and why it fails, if it does. */
async function build(logDir: string): Promise<{ result: string; why?: string }> {
  const outDir = env('OUT_DIR')
  mkdirSync(outDir, { recursive: true })
  // TICKET_JSON and COMMENTS_JSON: what a step fetched with `gh api`, the comments with `--paginate --slurp`, a list of pages
  const ticket = JSON.parse(readFileSync(env('TICKET_JSON'), 'utf8')) as Ticket
  const comments = (JSON.parse(readFileSync(env('COMMENTS_JSON'), 'utf8')) as Authored[][]).flat()
  const transcript = join(logDir, 'transcript.jsonl')
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
    logging: {
      type: 'file',
      path: join(logDir, 'sandcastle.log'),
      verbose: true,
      onAgentStreamEvent: (event: AgentStreamEvent) => {
        if (event.type === 'raw') appendFileSync(transcript, `${event.line}\n`)
      },
    },
  })
  for (const [at, { sessionFilePath }] of result.iterations.entries()) {
    if (sessionFilePath && existsSync(sessionFilePath)) copyFileSync(sessionFilePath, join(logDir, `session-${at + 1}.jsonl`))
  }
  writeFileSync(join(outDir, 'pr-body.md'), pullRequestBody(result.stdout, ticket.number, env('RUN_URL')))
  console.log(`The agent made ${result.commits.length} commit(s), merged into ${env('BRANCH')}.`)
  if (result.commits.length === 0) return { result: 'no-commits', why: 'The agent made no commit, so there is nothing to open a PR from.' }
  if (result.preservedWorktreePath) return { result: 'dirty', why: `The agent left changes it didn't commit, kept in ${result.preservedWorktreePath}.` }
  return { result: 'built' }
}

const logDir = process.env.LOG_DIR ?? '.'
try {
  mkdirSync(logDir, { recursive: true })
  const { result, why } = await build(env('LOG_DIR'))
  output(`result=${result}`)
  if (why) {
    console.log(`::error::${why}`)
    process.exitCode = 1
  }
} catch (error: unknown) {
  output('result=error')
  console.log(`::error::The build failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  const log = join(logDir, 'sandcastle.log')
  if (existsSync(log)) {
    console.log('::group::Sandcastle log')
    console.log(readFileSync(log, 'utf8'))
    console.log('::endgroup::')
  }
}
