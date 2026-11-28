// The factory's build of one ticket (#336), alone or a spec's (#337), run by .github/workflows/factory.yml once bwrap's
// probe has passed. It runs from the runner's checkout of the default branch, and builds in TREE, the workflow's clone
// of the branch the ticket is built on, which factory/factoryTree.ts readies: it runs Claude Code in Sandcastle's
// bwrap() sandbox on `/implement <n>` with the factory's rules and the ticket's text (factory/factoryTicket.ts), and
// Sandcastle merges the agent's commits into that branch. It pushes nothing and holds no GitHub token: the workflow's later jobs check the
// commits and do every write to GitHub.
//
// It writes `result` and `why` to the step's outputs (factory/factoryOutcome.ts); only `built` passes. Into LOG_DIR go
// the agent's stream-json as it comes (`transcript.jsonl`, so a stopped run keeps it), Sandcastle's log, and Claude
// Code's session; into OUT_DIR, the PR body, and for a spec's ticket its entry in the spec's decision log
// (`decision.md`, factory/factoryDecisionLog.ts). The other inputs are environment variables too:
// CLAUDE_CODE_OAUTH_TOKEN, TREE, TICKET_JSON, COMMENTS_JSON, SPEC_JSON and SPEC_COMMENTS_JSON (a spec's ticket only),
// BRANCH and RUN_URL.

import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { factoryConfig } from './factoryConfig.ts'
import { decisionEntry } from './factoryDecisionLog.ts'
import { buildOutcome, type BuildResult, type Ending } from './factoryOutcome.ts'
import { pullRequestBody } from './factoryPullRequest.ts'
import { factoryAgent, runInSandbox } from './factorySandcastle.ts'
import { prepareTree } from './factoryTree.ts'
import { ticketPrompt, type Authored, type Spec, type Ticket } from './factoryTicket.ts'

/**
 * The build's model; its budget, after whose turn Claude Code stops, so a stuck run can't spend without end; and the
 * check the workflow's `check` job runs on the agent's commits, which the prompt tells the agent.
 */
const config = factoryConfig()

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

/** Where the logs go, in LOG_DIR, which the workflow uploads. */
type Logs = { dir: string; transcript: string; sandcastle: string }

const logDir = process.env.LOG_DIR
const logs: Logs | undefined = logDir ? { dir: logDir, transcript: join(logDir, 'transcript.jsonl'), sandcastle: join(logDir, 'sandcastle.log') } : undefined

/** Runs the agent on the ticket, and writes the PR body from its reply. */
async function build(logs: Logs): Promise<Ending> {
  const outDir = env('OUT_DIR')
  mkdirSync(outDir, { recursive: true })
  // TICKET_JSON and COMMENTS_JSON: what a step fetched with `gh api`, the comments with `--paginate --slurp`, a list of pages
  const ticket = JSON.parse(readFileSync(env('TICKET_JSON'), 'utf8')) as Ticket
  const comments = (JSON.parse(readFileSync(env('COMMENTS_JSON'), 'utf8')) as Authored[][]).flat()
  // SPEC_JSON and SPEC_COMMENTS_JSON, for a spec's ticket: the spec and its comments, fetched as the ticket's are
  const spec: Spec | undefined = process.env.SPEC_JSON
    ? {
        issue: JSON.parse(readFileSync(process.env.SPEC_JSON, 'utf8')) as Ticket,
        comments: (JSON.parse(readFileSync(env('SPEC_COMMENTS_JSON'), 'utf8')) as Authored[][]).flat(),
      }
    : undefined
  const tree = env('TREE')
  // the worktree holds only what git tracks: the dependencies, and the skills installed from skills-lock.json, go in
  const setup = prepareTree(process.cwd(), tree, config.installCommand)
  const ran = await runInSandbox({
    name: `ticket-${ticket.number}`,
    cwd: tree,
    prompt: ticketPrompt(ticket, comments, config, spec),
    agent: factoryAgent(config.model, { oauthToken: env('CLAUDE_CODE_OAUTH_TOKEN'), maxBudgetUsd: config.budgetUsd }),
    // the test suite runs for minutes, past Claude Code's 2-minute default for a Bash command
    sandboxEnv: { BASH_DEFAULT_TIMEOUT_MS: '900000' },
    ...setup,
    copyToWorktreeMs: 600_000,
    idleTimeoutSeconds: 1200,
    logPath: logs.sandcastle,
    onLine: (line) => appendFileSync(logs.transcript, `${line}\n`),
  })
  for (const [at, sessionFile] of ran.sessionFiles.entries()) {
    if (sessionFile && existsSync(sessionFile)) copyFileSync(sessionFile, join(logs.dir, `session-${at + 1}.jsonl`))
  }
  writeFileSync(join(outDir, 'pr-body.md'), pullRequestBody(ran.stdout, ticket.number, env('RUN_URL'), config.checkCommand))
  if (spec) writeFileSync(join(outDir, 'decision.md'), decisionEntry(ticket, ran.stdout, env('BRANCH'), env('RUN_URL')))
  console.log(`The agent made ${ran.commits} commit(s), merged into ${env('BRANCH')}.`)
  return { commits: ran.commits, preservedWorktreePath: ran.preservedWorktreePath }
}

let ending: Ending
try {
  if (!logs) throw new Error('LOG_DIR is not set')
  mkdirSync(logs.dir, { recursive: true })
  ending = await build(logs)
} catch (error: unknown) {
  ending = { error }
}
const lines = logs && existsSync(logs.transcript) ? readFileSync(logs.transcript, 'utf8').split('\n') : []
const outcome = buildOutcome(ending, lines)
result(outcome.result)
if (outcome.result !== 'built') {
  // one line, as an output and a park comment's reason
  const said = outcome.why.split('\n')[0]!.slice(0, 300)
  output('why', said)
  console.log(`::error::${said}`)
  if ('error' in ending) console.error(ending.error)
  process.exitCode = 1
}
if (logs && existsSync(logs.sandcastle)) {
  console.log('::group::Sandcastle log')
  console.log(readFileSync(logs.sandcastle, 'utf8'))
  console.log('::endgroup::')
}
