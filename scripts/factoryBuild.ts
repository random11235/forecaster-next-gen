// The factory's build of one ticket (#336), run by .github/workflows/factory.yml once bwrap's probe has passed, on the
// branch the ticket is built on. It runs Claude Code in Sandcastle's bwrap() sandbox on `/implement <n>` with the
// ticket's text (scripts/factoryTicket.ts), and Sandcastle merges the agent's commits into that branch. It pushes
// nothing and holds no GitHub token: the workflow's later jobs check the commits and do every write to GitHub.
//
// It writes `result` and `why` to the step's outputs (scripts/factoryOutcome.ts); only `built` passes. Into LOG_DIR go
// the agent's stream-json as it comes (`transcript.jsonl`, so a stopped run keeps it), Sandcastle's log, and Claude
// Code's session; into OUT_DIR, the PR body. The other inputs are environment variables too: CLAUDE_CODE_OAUTH_TOKEN,
// TICKET_JSON, COMMENTS_JSON, BRANCH and RUN_URL.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, type AgentStreamEvent } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { factoryAgent } from './factoryAgent.ts'
import { buildOutcome, type BuildResult, type Ending } from './factoryOutcome.ts'
import { pullRequestBody } from './factoryPullRequest.ts'
import { ticketPrompt, type Authored, type Ticket } from './factoryTicket.ts'

const MODEL = 'opus'
/** Claude Code stops after the turn that passes this, so a stuck run can't spend without end. */
const MAX_BUDGET_USD = 25

const output = (name: 'result' | 'why', value: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`)
}
const result = (value: BuildResult) => output('result', value)
result('started')

const env = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

const logDir = process.env.LOG_DIR
const transcript = logDir && join(logDir, 'transcript.jsonl')
const sandcastleLog = logDir && join(logDir, 'sandcastle.log')

/** Runs the agent on the ticket, and writes the PR body from its reply. */
async function build(logs: string): Promise<Ending> {
  const outDir = env('OUT_DIR')
  mkdirSync(outDir, { recursive: true })
  // TICKET_JSON and COMMENTS_JSON: what a step fetched with `gh api`, the comments with `--paginate --slurp`, a list of pages
  const ticket = JSON.parse(readFileSync(env('TICKET_JSON'), 'utf8')) as Ticket
  const comments = (JSON.parse(readFileSync(env('COMMENTS_JSON'), 'utf8')) as Authored[][]).flat()
  const ran = await run({
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
      path: join(logs, 'sandcastle.log'),
      verbose: true,
      onAgentStreamEvent: (event: AgentStreamEvent) => {
        if (event.type === 'raw') appendFileSync(join(logs, 'transcript.jsonl'), `${event.line}\n`)
      },
    },
  })
  for (const [at, { sessionFilePath }] of ran.iterations.entries()) {
    if (sessionFilePath && existsSync(sessionFilePath)) copyFileSync(sessionFilePath, join(logs, `session-${at + 1}.jsonl`))
  }
  writeFileSync(join(outDir, 'pr-body.md'), pullRequestBody(ran.stdout, ticket.number, env('RUN_URL')))
  console.log(`The agent made ${ran.commits.length} commit(s), merged into ${env('BRANCH')}.`)
  return { commits: ran.commits.length, preservedWorktreePath: ran.preservedWorktreePath }
}

let ending: Ending
try {
  if (!logDir) throw new Error('LOG_DIR is not set')
  mkdirSync(logDir, { recursive: true })
  ending = await build(logDir)
} catch (error: unknown) {
  ending = { error }
}
const lines = transcript && existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n') : []
const { result: final, why } = buildOutcome(ending, lines)
result(final)
if (why) {
  // one line, as an output and a park comment's reason
  const said = why.split('\n')[0]!.slice(0, 300)
  output('why', said)
  console.log(`::error::${said}`)
  if ('error' in ending) console.error(ending.error)
  process.exitCode = 1
}
if (sandcastleLog && existsSync(sandcastleLog)) {
  console.log('::group::Sandcastle log')
  console.log(readFileSync(sandcastleLog, 'utf8'))
  console.log('::endgroup::')
}
