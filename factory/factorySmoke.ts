// The factory's smoke test (#335), run by .github/workflows/factory-smoke.yml once bwrap's probe has passed. It runs
// Claude Code in Sandcastle's bwrap() sandbox on `/factory-smoke`, a skill only the slash command can run, which has the
// agent say a word first, list the names in its env and in Claude Code's, and try to write outside its working tree.
// Then it checks what reached the host (factory/smokeVerdict.ts); whether the slash command expands on stdin, as
// Sandcastle sends it; and that a budget cap stops a run. It builds nothing: the agent's tree is thrown away.
// Needs CLAUDE_CODE_OAUTH_TOKEN.

import { appendFileSync, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factoryAgent, runInSandbox, stdinAgent, type FactoryAgent } from './factorySandcastle.ts'
import { hostWrite, reachedHost, type DirSeen, type FileSeen, type Seen, type Watched } from './smokeHost.ts'
import { budgetVerdict, controlWrites, smokeVerdict, stdinNote, type Check, type Ending, type Write } from './smokeVerdict.ts'

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

// The agent can write in the git dir, so it could swap a directory there (refs/heads, say) for a symlink or a file, or
// remove one. factory/smokeHost.ts decides from what this sees, before the run and after, whether a write reached the
// host and how to undo it. A directory the agent made where one was missing counts as reaching the host, even empty;
// restoring removes the target in it but leaves the directory, and warns of it.
/** Where `path`'s directory really is, or would be if it's missing: under its nearest ancestor's real path. */
function homeOf(path: string): string {
  const missing: string[] = []
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    try {
      return join(realpathSync(dir), ...missing)
    } catch {
      missing.unshift(basename(dir))
    }
  }
}
/**
 * What's at `path` and its directory on the host. The directory is followed, to where it really is; the path is lstat'd,
 * so a symlink the agent left is seen as one.
 */
function seen(path: string): Seen {
  return { dir: seenDir(dirname(path)), file: seenFile(path) }
}
function seenDir(dir: string): DirSeen {
  try {
    return statSync(dir).isDirectory() ? { kind: 'directory', real: realpathSync(dir) } : { kind: 'other' }
  } catch (error: unknown) {
    const code = codeOf(error)
    if (code === 'ENOENT') return { kind: 'missing' }
    // ENOTDIR: an ancestor isn't a directory, so neither is this
    return code === 'ENOTDIR' ? { kind: 'other' } : { kind: 'unreadable', code }
  }
}
function codeOf(error: unknown): string {
  return (error as NodeJS.ErrnoException).code ?? String(error)
}
function seenFile(path: string): FileSeen {
  try {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink()) return { kind: 'symlink', target: readlinkSync(path) }
    return stat.isFile() ? { kind: 'file', content: readFileSync(path, 'utf8') } : { kind: 'other' }
  } catch (error: unknown) {
    // Any other error, such as EACCES from a file, or a directory, the agent made unreadable, may hide a write, so
    // counts as one
    return ['ENOENT', 'ENOTDIR'].includes(codeOf(error)) ? { kind: 'missing' } : { kind: 'other' }
  }
}

// What was there before: only the git config, which the agent appends to. This is read from disk, so a local run that
// crashed before restoring would bake its comment in. Restoring runs after Sandcastle's host-side merge, so it cleans up
// after the run; it doesn't protect the host while the run goes on. It removes what's there first, so a symlink the
// agent left is replaced, not written through.
const watched = targets.map((target) => ({ ...target, before: { ...seen(target.path), home: homeOf(target.path) } satisfies Watched }))
// A target that's a symlink, or neither a file nor missing (a directory, or unreadable), would hide writes through it or
// in it, and restoring wouldn't make it again
const hiding = watched.filter(({ before }) => before.file.kind === 'symlink' || before.file.kind === 'other').map(({ path }) => path)
if (hiding.length > 0) {
  throw new Error(`targets are symlinks, or neither files nor missing, before the run, so writes to them would go unseen: ${hiding.join(', ')}`)
}
const now = ({ path, before }: (typeof watched)[number]) => hostWrite(before, seen(path))
/** The warnings given, so a directory that stays moved is warned of once, not after each run. */
const warned = new Set<string>()
const warn = (warning: string) => {
  if (!warned.has(warning)) console.log(`::warning::${warning}`)
  warned.add(warning)
}
/** The targets restoring failed on, after any run, which fail the smoke test: the host kept what the agent left. */
const unrestored = new Set<string>()
const restore = () => {
  for (const target of watched) {
    const undo = now(target)
    if (undo.do !== 'nothing' && undo.warn !== undefined) warn(`${dirname(target.path)} ${undo.warn}`)
    if (undo.do !== 'remove') continue
    try {
      rmSync(target.path, { force: true, recursive: true })
      if (undo.put !== undefined) writeFileSync(target.path, undo.put)
    } catch (error: unknown) {
      // such as EACCES from a directory the agent made unreadable
      warn(`${target.path} couldn't be restored: ${codeOf(error)}`)
      unrestored.add(target.path)
    }
  }
}

type Run = { stream: string[]; ending: Ending; commits: number }

/** One run of the agent, logged to a file and its stream-json kept. */
async function runAgent(name: string, prompt: string, agent: FactoryAgent): Promise<Run> {
  const stream: string[] = []
  const log = join(temp, `${name}.log`)
  try {
    const result = await runInSandbox({ name, prompt, agent, idleTimeoutSeconds: 120, logPath: log, onLine: (line) => stream.push(line) })
    return { stream, ending: { stdout: result.stdout }, commits: result.commits }
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
const writes = watched.map((target) => ({ path: target.path, about: target.about, changedOnHost: reachedHost(now(target)) }))
restore()

// The control: Sandcastle's own way, the prompt on stdin. The skill isn't given its paths, so should write nothing; any
// write that reaches the host is judged as the smoke run's are, against the host as restoring left it, so what the smoke
// run's agent left isn't counted again.
const afterSmoke = watched.map((target) => ({ ...target, before: { ...seen(target.path), home: target.before.home } satisfies Watched }))
const control = await runAgent('factory-smoke-stdin', '/factory-smoke', stdinAgent(MODEL, { oauthToken, maxBudgetUsd: 0.1 }))
const controlWritten: Write[] = afterSmoke.map((target) => ({ path: target.path, changedOnHost: reachedHost(now(target)) }))
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
  ...controlWrites(controlWritten, gitDir),
  budgetVerdict(capped.ending, CAP),
  ...(unrestored.size > 0
    ? [{ status: 'fail' as const, says: `restoring failed at least once, so the host kept what the agent left, at ${[...unrestored].join(', ')}` }]
    : []),
]
const lines = checks.map(({ status, says }) => `${status.toUpperCase()} ${says}`)
console.log(lines.join('\n'))
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Factory smoke test\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`)
}
if (checks.some(({ status }) => status === 'fail')) process.exitCode = 1
