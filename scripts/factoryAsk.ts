// The factory's answer to a question (#380), run by .github/workflows/factory.yml's `ask` job once bwrap's probe has
// passed: Claude Code, in Sandcastle's bwrap() sandbox, with tools that only read files (scripts/factoryAgent.ts), on the
// question and the issue a step fetched and the default branch's latest commits (scripts/factoryQuestion.ts), in the
// runner's checkout of the default branch. It builds and pushes nothing, and the sandbox holds no GitHub token, only
// the OAuth one: the `reply` job posts what it writes.
//
// Into OUT_DIR it writes `reply.md`, the comment to post: the agent's answer, or why there is none. Into LOG_DIR go the
// agent's stream-json (`transcript.jsonl`) and Sandcastle's log. The other inputs are environment variables too:
// CLAUDE_CODE_OAUTH_TOKEN, GITHUB_EVENT_PATH, or REVIEW_COMMENT_JSON for a question asked on a line, ISSUE_JSON,
// COMMENTS_JSON, REVIEW_COMMENTS_JSON (a PR's comments on lines of its diff, empty for an issue), PRS_JSON and RUN_URL.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { run, type AgentStreamEvent } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { readOnlyAgent } from './factoryAgent.ts'
import { buildOutcome } from './factoryOutcome.ts'
import {
  questionPrompt,
  relayedEvent,
  replyTo,
  type Answered,
  type Comment,
  type CommentEvent,
  type Issue,
  type PullRequest,
  type ReviewComment,
} from './factoryQuestion.ts'

const MODEL = 'opus'
/** An answer reads and writes no code, so it needs far less than a build's $25. */
const MAX_BUDGET_USD = 3
/** How many of the default branch's commits the prompt lists. */
const COMMITS = 30

const env = (name: string): string => {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}
const json = <T>(name: string): T => JSON.parse(readFileSync(env(name), 'utf8')) as T

const logDir = env('LOG_DIR')
const outDir = env('OUT_DIR')
mkdirSync(logDir, { recursive: true })
mkdirSync(outDir, { recursive: true })
const transcript = join(logDir, 'transcript.jsonl')
const sandcastleLog = join(logDir, 'sandcastle.log')
const event = process.env.REVIEW_COMMENT_JSON ? relayedEvent(json<ReviewComment>('REVIEW_COMMENT_JSON')) : json<CommentEvent>('GITHUB_EVENT_PATH')

let answered: Answered
try {
  const commits = execFileSync('git', ['log', `-n${COMMITS}`, '--date=short', '--format=%h %ad %s'], { encoding: 'utf8' })
  const comments = [...json<Comment[][]>('COMMENTS_JSON').flat(), ...json<Comment[][]>('REVIEW_COMMENTS_JSON').flat()]
  const prompt = questionPrompt(event, json<Issue>('ISSUE_JSON'), comments, json<PullRequest[]>('PRS_JSON'), commits)
  const ran = await run({
    name: `question-${event.issue.number}`,
    prompt,
    agent: readOnlyAgent(MODEL, { oauthToken: env('CLAUDE_CODE_OAUTH_TOKEN'), maxBudgetUsd: MAX_BUDGET_USD }),
    sandbox: bwrap(),
    branchStrategy: { type: 'merge-to-head' },
    maxIterations: 1,
    idleTimeoutSeconds: 300,
    logging: {
      type: 'file',
      path: sandcastleLog,
      verbose: true,
      onAgentStreamEvent: (each: AgentStreamEvent) => {
        if (each.type === 'raw') appendFileSync(transcript, `${each.line}\n`)
      },
    },
  })
  answered = { stdout: ran.stdout }
} catch (error: unknown) {
  console.error(error)
  const lines = existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n') : []
  const outcome = buildOutcome({ error }, lines)
  answered = { why: 'why' in outcome ? outcome.why.split('\n')[0]!.slice(0, 300) : 'the agent failed' }
  process.exitCode = 1
}
writeFileSync(join(outDir, 'reply.md'), replyTo(event.comment, answered, env('RUN_URL')))
if (existsSync(sandcastleLog)) {
  console.log('::group::Sandcastle log')
  console.log(readFileSync(sandcastleLog, 'utf8'))
  console.log('::endgroup::')
}
