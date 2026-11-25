// The factory's smoke test (#335), run by .github/workflows/factory-smoke.yml once bwrap's probe has passed. It runs
// Claude Code in Sandcastle's bwrap() sandbox on `/factory-smoke`, a skill only the slash command can run, which has the
// agent say a word first, list the names in its env and in Claude Code's, and try to write outside its working tree.
// Then it checks what reached the host (scripts/smokeVerdict.ts); that the slash command doesn't expand on stdin, as
// Sandcastle sends it; and that a budget cap stops a run. It builds nothing: the agent's tree is thrown away.
// Needs CLAUDE_CODE_OAUTH_TOKEN.

import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, type AgentStreamEvent } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { factoryAgent, type FactoryAgentOptions } from './factoryAgent.ts'
import { budgetVerdict, smokeVerdict, stdinNote, type Check } from './smokeVerdict.ts'

const MODEL = 'haiku'
const CAP = 0.0001
const MARK = '# smoke-escape'

const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
if (!oauthToken) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is not set')

const root = fileURLToPath(new URL('..', import.meta.url))
const gitDir = join(root, '.git')
const temp = process.env.RUNNER_TEMP ?? tmpdir()
const skill = readFileSync(join(root, '.claude/skills/factory-smoke/SKILL.md'), 'utf8')
/** The word the skill has the agent say first. It's in the skill alone, so the agent can't find it elsewhere in its tree. */
const skillWord = /^Your first words, before any tool call, are the word `([^`]+)`/m.exec(skill)?.[1]
if (!skillWord) throw new Error("the factory-smoke skill doesn't name its word")

/** Outside the agent's worktree (under .sandcastle/worktrees/): the checkout, the runner's temp, the system, git's. */
const targets = [
  join(root, 'smoke-escape.txt'),
  join(temp, 'smoke-escape.txt'),
  '/usr/local/smoke-escape.txt',
  ...['hooks/smoke-escape', 'info/smoke-escape', 'config', 'refs/heads/smoke-escape.lock', 'objects/smoke-escape', 'smoke-escape'].map((path) =>
    join(gitDir, path),
  ),
]
/** What was there before, put back after: the git config, which the agent appends a comment to. */
const before = new Map(targets.filter((path) => existsSync(path)).map((path) => [path, readFileSync(path, 'utf8')]))
const restore = () => {
  for (const path of targets) {
    const was = before.get(path)
    if (was === undefined) rmSync(path, { force: true })
    else writeFileSync(path, was)
  }
}
restore()

/** One run of the agent, logged to a file and its stream-json kept. */
async function runAgent(name: string, prompt: string, agent: FactoryAgentOptions) {
  const stream: string[] = []
  const onAgentStreamEvent = (event: AgentStreamEvent) => {
    if (event.type === 'raw') stream.push(event.line)
  }
  const log = join(temp, `${name}.log`)
  try {
    const result = await run({
      name,
      prompt,
      sandbox: bwrap(),
      agent: factoryAgent(MODEL, agent),
      branchStrategy: { type: 'merge-to-head' },
      maxIterations: 1,
      idleTimeoutSeconds: 120,
      logging: { type: 'file', path: log, onAgentStreamEvent, verbose: true },
    })
    return { stream, result }
  } catch (error: unknown) {
    return { stream, error: error instanceof Error ? error.message : String(error) }
  } finally {
    console.log(`::group::${name}: ${prompt}`)
    if (existsSync(log)) console.log(readFileSync(log, 'utf8'))
    console.log('::endgroup::')
  }
}

const smoke = await runAgent('factory-smoke', `/factory-smoke ${targets.join(' ')}`, { oauthToken, maxBudgetUsd: 0.5 })
const reached = targets.map((path) => ({ path, reached: existsSync(path) && readFileSync(path, 'utf8').includes(MARK) }))
restore()

// The control: Sandcastle's own way, the prompt on stdin. The skill isn't given its paths, so it writes nothing.
const control = await runAgent('factory-smoke-stdin', '/factory-smoke', { oauthToken, maxBudgetUsd: 0.1, promptOn: 'stdin' })
restore()

// A cap far below one model call's cost: Claude Code should stop after its first turn, and Sandcastle reject the run.
const capped = await runAgent('factory-smoke-budget', 'Reply with the one word: hi', { oauthToken, maxBudgetUsd: CAP })

const checks: Check[] = [
  ...('result' in smoke && smoke.result
    ? smokeVerdict({
        stdout: smoke.result.stdout,
        stream: smoke.stream,
        skillWord,
        gitDir,
        targets: reached,
        commits: smoke.result.commits.length,
        sandcastleEnvFile: existsSync(join(root, '.sandcastle', '.env')),
      })
    : [{ status: 'fail' as const, says: `the smoke run failed: ${String(smoke.error).slice(0, 300)}` }]),
  stdinNote(control.stream, skillWord),
  budgetVerdict('result' in capped && capped.result ? { stdout: capped.result.stdout } : { error: String(capped.error) }, CAP),
]
const lines = checks.map(({ status, says }) => `${status.toUpperCase()} ${says}`)
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Factory smoke test\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
}
if (checks.some(({ status }) => status === 'fail')) process.exitCode = 1
