// The factory's answer to a question (#380), run by .github/workflows/factory.yml's `ask` job once bwrap's probe has
// passed: Claude Code, in Sandcastle's bwrap() sandbox, with tools that only read files (factory/factorySandcastle.ts), on the
// question and the issue a step fetched and the default branch's latest commits (factory/factoryQuestion.ts), in the
// runner's checkout of the default branch. It builds and pushes nothing, and the sandbox holds no GitHub token, only
// the OAuth one: the `reply` job posts what it writes.
//
// Into OUT_DIR it writes `reply.md`, the comment to post: the agent's answer, or why there is none. Into LOG_DIR go the
// agent's stream-json (`transcript.jsonl`) and Sandcastle's log. The other inputs are environment variables too:
// CLAUDE_CODE_OAUTH_TOKEN, GITHUB_EVENT_PATH, or REVIEW_COMMENT_JSON for a question asked on a line, ISSUE_JSON,
// COMMENTS_JSON, REVIEW_COMMENTS_JSON (a PR's comments on lines of its diff, empty for an issue), PRS_JSON, RUN_URL, and
// for a spec or a spec's ticket SPEC_JSON and SPEC_COMMENTS_JSON: the spec and its comments, which hold its decision log.

import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { factoryConfig } from './factoryConfig.ts'
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
import { readOnlyAgent, runInSandbox } from './factorySandcastle.ts'
import type { Ticket } from './factoryTicket.ts'

/** The workflow's config: a question's model, budget, idle timeout and commit count, and the mark and mention. */
const config = factoryConfig()

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
  const commits = execFileSync('git', ['log', `-n${config.askCommits}`, '--date=short', '--format=%h %ad %s'], { encoding: 'utf8' })
  const comments = [...json<Comment[][]>('COMMENTS_JSON').flat(), ...json<Comment[][]>('REVIEW_COMMENTS_JSON').flat()]
  const spec = process.env.SPEC_JSON ? { issue: json<Ticket>('SPEC_JSON'), comments: json<Comment[][]>('SPEC_COMMENTS_JSON').flat() } : undefined
  const prompt = questionPrompt(event, json<Issue>('ISSUE_JSON'), comments, json<PullRequest[]>('PRS_JSON'), commits, config, spec)
  const ran = await runInSandbox({
    name: `question-${event.issue.number}`,
    prompt,
    agent: readOnlyAgent(config.askModel, { oauthToken: env('CLAUDE_CODE_OAUTH_TOKEN'), maxBudgetUsd: config.askBudgetUsd }),
    idleTimeoutSeconds: config.askIdleSeconds,
    logPath: sandcastleLog,
    onLine: (line) => appendFileSync(transcript, `${line}\n`),
  })
  answered = { stdout: ran.stdout }
} catch (error: unknown) {
  console.error(error)
  const lines = existsSync(transcript) ? readFileSync(transcript, 'utf8').split('\n') : []
  const outcome = buildOutcome({ error }, lines)
  answered = { why: 'why' in outcome ? outcome.why.split('\n')[0]!.slice(0, 300) : 'the agent failed' }
  process.exitCode = 1
}
writeFileSync(join(outDir, 'reply.md'), replyTo(event.comment, answered, env('RUN_URL'), config))
if (existsSync(sandcastleLog)) {
  console.log('::group::Sandcastle log')
  console.log(readFileSync(sandcastleLog, 'utf8'))
  console.log('::endgroup::')
}
