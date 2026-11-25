// The factory's smoke test (#335), run by .github/workflows/factory-smoke.yml once bwrap's probe has passed. It runs
// Claude Code in Sandcastle's bwrap() sandbox on `/factory-smoke`, a skill only the slash command can run, which has the
// agent list its env's names and try to write outside its working tree. Then it checks what reached the host
// (scripts/smokeVerdict.ts), and that a budget cap stops a run. It builds nothing: the agent's tree is thrown away.
// Needs CLAUDE_CODE_OAUTH_TOKEN; run from the repo's root.

import { appendFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { factoryAgent } from './factoryAgent.ts'
import { smokeVerdict, type Check } from './smokeVerdict.ts'

const MODEL = 'haiku'
/** The word only `.claude/skills/factory-smoke/SKILL.md` holds. */
const SKILL_WORD = 'marmalade-heron'
const REPORT = /<smoke-report>([\s\S]*?)<\/smoke-report>/

const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
if (!oauthToken) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is not set')

const root = process.cwd()
const gitDir = join(root, '.git')
/** Outside the agent's worktree (under .sandcastle/worktrees/): the checkout, the runner's temp, the system, git's. */
const targets = [
  join(root, 'smoke-escape.txt'),
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'smoke-escape.txt'),
  '/usr/local/smoke-escape.txt',
  join(gitDir, 'hooks', 'smoke-escape'),
  join(gitDir, 'smoke-escape.txt'),
]
for (const path of targets) rmSync(path, { force: true })

const options = { sandbox: bwrap(), branchStrategy: { type: 'merge-to-head' }, maxIterations: 1, idleTimeoutSeconds: 120 } as const

console.log(`::group::The agent, on /factory-smoke`)
const smoke = await run({
  ...options,
  name: 'factory-smoke',
  agent: factoryAgent(MODEL, { oauthToken, maxBudgetUsd: 0.5 }),
  prompt: `/factory-smoke ${targets.join(' ')}`,
  logging: { type: 'stdout' },
})
console.log('::endgroup::')

const landed = targets.map((path) => ({ path, landed: existsSync(path) }))
for (const path of targets) rmSync(path, { force: true })

// A cap far below one model call's cost: Claude Code should stop after its first turn, and Sandcastle reject the run.
console.log(`::group::The agent, capped at $0.0001`)
const capped: Check = await run({
  ...options,
  name: 'factory-smoke-budget',
  agent: factoryAgent(MODEL, { oauthToken, maxBudgetUsd: 0.0001 }),
  prompt: 'Reply with the one word: hi',
  logging: { type: 'stdout' },
}).then(
  (result) => ({ ok: false, says: `the $0.0001 cap didn't stop the run, which said: ${result.stdout.trim()}` }),
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    return /budget/i.test(message)
      ? { ok: true, says: `the $0.0001 cap stopped the run: ${message.split('\n').join(' ')}` }
      : { ok: false, says: `the capped run failed, not on its budget: ${message}` }
  },
)
console.log('::endgroup::')

const checks = [...smokeVerdict({ report: REPORT.exec(smoke.stdout)?.[1]?.trim(), skillWord: SKILL_WORD, gitDir, targets: landed }), capped]
const lines = checks.map(({ ok, says }) => `${ok ? 'PASS' : 'FAIL'} ${says}`)
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Factory smoke test\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
}
if (checks.some(({ ok }) => !ok)) process.exitCode = 1
