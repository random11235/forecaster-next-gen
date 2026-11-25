// The factory's smoke test (#335), run by .github/workflows/factory-smoke.yml once bwrap's probe has passed. It runs
// Claude Code in Sandcastle's bwrap() sandbox on `/factory-smoke`, a skill only the slash command can run, which has the
// agent say a word first, list the names in its env and in Claude Code's, and try to write outside its working tree.
// Then it checks what reached the host (scripts/smokeVerdict.ts); whether the slash command expands on stdin, as
// Sandcastle sends it; and that a budget cap stops a run. It builds nothing: the agent's tree is thrown away.
// Needs CLAUDE_CODE_OAUTH_TOKEN.

import { appendFileSync, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, type AgentProvider, type AgentStreamEvent } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { factoryAgent, stdinAgent } from './factoryAgent.ts'
import { budgetVerdict, smokeVerdict, stdinNote, type Check, type Ending } from './smokeVerdict.ts'

const MODEL = 'haiku'
const CAP = 0.0001

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
const targets: { path: string; about?: string }[] = [
  { path: join(root, 'smoke-escape.txt') },
  // bwrap's tmpfs on /home hides the runner's temp dir, so this tests only that, not that it can't be written
  { path: join(temp, 'smoke-escape.txt'), about: 'which tests only that the sandbox hides RUNNER_TEMP, under its /home' },
  { path: '/usr/local/smoke-escape.txt' },
  ...['hooks/smoke-escape', 'info/smoke-escape', 'config', 'refs/heads/smoke-escape.lock', 'objects/smoke-escape', 'smoke-escape'].map((path) => ({
    path: join(gitDir, path),
  })),
]

// The agent can write in the git dir, so it could swap a directory there (refs/heads, say) for a symlink, or remove
// one. A target whose directory has moved or gone is then neither read nor removed. One the agent created where none
// was is a change like any other, so its file is read and removed.
function realDir(path: string): string | undefined {
  try {
    return realpathSync(dirname(path))
  } catch {
    return undefined
  }
}
/** Where `path`'s directory really is, or would be if it's missing: under its nearest ancestor's real path. */
function homeOf(path: string): string {
  const missing: string[] = []
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    try {
      return join(realpathSync(dir), ...missing)
    } catch {
      if (dirname(dir) === dir) return dirname(path)
      missing.unshift(basename(dir))
    }
  }
}
const homes = new Map(targets.map(({ path }) => [path, homeOf(path)]))
const hadDir = new Set(targets.filter(({ path }) => realDir(path) !== undefined).map(({ path }) => path))
/** Whether `path`'s directory is where it was before the run (or, missing then, where it would have been). */
function whereabouts(path: string): 'home' | 'removed' | 'moved' {
  const now = realDir(path)
  if (now === undefined) return hadDir.has(path) ? 'removed' : 'home'
  return now === homes.get(path) ? 'home' : 'moved'
}

/** What's at `path` on the host, lstat'd so a symlink the agent leaves is seen as one, not followed. */
function state(path: string): string | undefined {
  const where = whereabouts(path)
  if (where === 'removed') return 'in a removed directory'
  if (where === 'moved') return `in a moved directory, now ${String(realDir(path))}`
  if (!existsSync(path) && !isLink(path)) return undefined
  if (isLink(path)) return `symlink to ${readlinkSync(path)}`
  return lstatSync(path).isFile() ? `file: ${readFileSync(path, 'utf8')}` : 'not a file'
}
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

// What was there before: only the git config, which the agent appends to. This is read from disk, so a local run that
// crashed before restoring would bake its comment in. Restoring runs after Sandcastle's host-side merge, so it cleans up
// after the run; it doesn't protect the host while the run goes on. It removes what's there first, so a symlink the
// agent left is replaced, not written through.
const before = new Map(targets.map(({ path }) => [path, state(path)]))
/** The directories already warned of, so one that stays moved is warned of once, not after each run. */
const warned = new Set<string>()
const restore = () => {
  for (const { path } of targets) {
    const was = before.get(path)
    if (state(path) === was) continue
    const where = whereabouts(path)
    if (where !== 'home') {
      const dir = dirname(path)
      const how = where === 'removed' ? 'was removed' : `moved, to ${String(realDir(path))}`
      if (!warned.has(dir)) console.log(`::warning::${dir} ${how} during the run: left as it is`)
      warned.add(dir)
      continue
    }
    rmSync(path, { force: true, recursive: true })
    if (was?.startsWith('file: ')) writeFileSync(path, was.slice('file: '.length))
  }
}

type Run = { stream: string[]; ending: Ending; commits: number }

/** One run of the agent, logged to a file and its stream-json kept. */
async function runAgent(name: string, prompt: string, agent: AgentProvider): Promise<Run> {
  const stream: string[] = []
  const onAgentStreamEvent = (event: AgentStreamEvent) => {
    if (event.type === 'raw') stream.push(event.line)
  }
  const log = join(temp, `${name}.log`)
  try {
    const result = await run({
      name,
      prompt,
      agent,
      sandbox: bwrap(),
      branchStrategy: { type: 'merge-to-head' },
      maxIterations: 1,
      idleTimeoutSeconds: 120,
      logging: { type: 'file', path: log, onAgentStreamEvent, verbose: true },
    })
    return { stream, ending: { stdout: result.stdout }, commits: result.commits.length }
  } catch (error: unknown) {
    return { stream, ending: { error: error instanceof Error ? error.message : String(error) }, commits: 0 }
  } finally {
    console.log(`::group::${name}: ${prompt}`)
    if (existsSync(log)) console.log(readFileSync(log, 'utf8'))
    console.log('::endgroup::')
  }
}

const smoke = await runAgent(
  'factory-smoke',
  `/factory-smoke ${targets.map(({ path }) => path).join(' ')}`,
  factoryAgent(MODEL, { oauthToken, maxBudgetUsd: 0.5 }),
)
const writes = targets.map(({ path, about }) => ({ path, about, changedOnHost: state(path) !== before.get(path) }))
restore()

// The control: Sandcastle's own way, the prompt on stdin. The skill isn't given its paths, so it writes nothing.
const control = await runAgent('factory-smoke-stdin', '/factory-smoke', stdinAgent(MODEL, { oauthToken, maxBudgetUsd: 0.1 }))
restore()

// A cap far below one model call's cost: Claude Code should stop after its first turn, and Sandcastle reject the run.
const capped = await runAgent('factory-smoke-budget', 'Reply with the one word: hi', factoryAgent(MODEL, { oauthToken, maxBudgetUsd: CAP }))

const checks: Check[] = [
  ...('stdout' in smoke.ending
    ? smokeVerdict({
        stdout: smoke.ending.stdout,
        stream: smoke.stream,
        skillWord,
        gitDir,
        writes,
        commits: smoke.commits,
        sandcastleEnvFile: existsSync(join(root, '.sandcastle', '.env')),
      })
    : [{ status: 'fail' as const, says: `the smoke run failed: ${smoke.ending.error.slice(0, 300)}` }]),
  stdinNote(control.stream, skillWord),
  budgetVerdict(capped.ending, CAP),
]
const lines = checks.map(({ status, says }) => `${status.toUpperCase()} ${says}`)
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Factory smoke test\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
}
if (checks.some(({ status }) => status === 'fail')) process.exitCode = 1
