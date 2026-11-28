// The factory's one adapter to Sandcastle: the only module that imports @ai-hero/sandcastle. It builds the agent the
// factory runs, runs it in the sandbox, and turns what that threw into the factory's own failure. A Sandcastle bump
// touches this module, its test (factory/test/factorySandcastle.test.ts) and the smoke test, nothing else.
//
// Sandcastle is pinned at exactly 0.14.0, because this relies on parts of it Sandcastle doesn't promise to keep
// (docs/research/sandcastle-factory.md, section 3):
//
// - **The command claudeCode() builds, ending `-p -`.** It sends the prompt on stdin, where Claude Code doesn't expand
//   a slash command such as `/implement 12`: the model gets the text and finds the skill itself, if it does (#335). It
//   has no option for `--max-budget-usd`, nor for the read-only agent's tool flags, either. So this rewrites that
//   command, and throws once it stops ending in `-p -`.
// - **Effect's FiberFailure, and the `_tag` of Sandcastle's errors.** run() rethrows from Effect.runPromise, so its
//   error is inside a FiberFailure's Cause, and AgentIdleTimeoutError is known only by its tag. Sandcastle exports
//   neither, so the test builds them from the bundled chunks it imports by name, which a bump renames.
//
// The prompt will carry issue text, so it goes in as one shell word after `--`: Claude Code reads none of it as an
// option. As an argument, it's in the command line, which anything in the sandbox can read from /proc/<pid>/cmdline.

import { claudeCode, run, type AgentProvider, type AgentStreamEvent } from '@ai-hero/sandcastle'
import { bwrap } from '@ai-hero/sandcastle/sandboxes/bwrap'
import { MAX_PROMPT_BYTES, shellWord } from './factoryShell.ts'

export { MAX_PROMPT_BYTES }

/** The agent the factory runs: Claude Code, as Sandcastle runs it. */
export type FactoryAgent = AgentProvider

export type FactoryAgentOptions = {
  /** CLAUDE_CODE_OAUTH_TOKEN, the one secret the sandbox gets. */
  oauthToken: string
  /** Claude Code stops once a run's cost, as it reckons it after each turn, passes this many dollars. */
  maxBudgetUsd: number
}

const STDIN_PROMPT = ' -p -'

/** claudeCode()'s `command` without its closing `-p -`, which it throws without. */
function withoutStdinPrompt(command: string): string {
  if (!command.endsWith(STDIN_PROMPT)) throw new Error(`claudeCode()'s command no longer ends in -p -: ${command}`)
  return command.slice(0, -STDIN_PROMPT.length)
}

/** claudeCode()'s `command`, without its closing `-p -`, then `flags` and the budget cap. */
const capped = (command: string, maxBudgetUsd: number, flags = ''): string => `${withoutStdinPrompt(command)}${flags} --max-budget-usd ${maxBudgetUsd}`

/**
 * claudeCode()'s `command`, which ends in `-p -`, with any `flags`, the budget cap, and `prompt` as the argument in
 * place of `-p -`.
 */
export function withPromptArgument(command: string, prompt: string, maxBudgetUsd: number, flags = ''): string {
  const start = capped(command, maxBudgetUsd, flags)
  if (prompt.includes('\0')) throw new Error('the prompt holds a NUL byte, which no command line can carry')
  const word = shellWord(prompt)
  const bytes = Buffer.byteLength(word)
  if (bytes > MAX_PROMPT_BYTES) {
    throw new Error(`the prompt, quoted for the shell, is ${bytes} bytes, more than the ${MAX_PROMPT_BYTES} a command line can safely hold`)
  }
  return `${start} -p -- ${word}`
}

type PromptOn = (command: string, prompt: string, maxBudgetUsd: number) => { command: string; stdin: string }

function agentWith(model: string, { oauthToken, maxBudgetUsd }: FactoryAgentOptions, promptOn: PromptOn, permissionMode?: 'dontAsk'): FactoryAgent {
  const agent = claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken }, ...(permissionMode && { permissionMode }) })
  return {
    ...agent,
    buildPrintCommand(options) {
      return promptOn(agent.buildPrintCommand(options).command, options.prompt, maxBudgetUsd)
    },
  }
}

/** The agent that builds: Claude Code, with the OAuth token in its env alone, a budget cap, and the prompt as its argument. */
export function factoryAgent(model: string, options: FactoryAgentOptions): FactoryAgent {
  return agentWith(model, options, (command, prompt, maxBudgetUsd) => ({ command: withPromptArgument(command, prompt, maxBudgetUsd), stdin: '' }))
}

/** The only tools the agent answering a question has, all of which read files: no shell, so no `git` or `gh`. */
const READ_TOOLS = ['Read', 'Grep', 'Glob']
/** Denied outright too, though `--tools` leaves them out. */
const DENIED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']

/**
 * The agent that answers a question (factory/factoryAsk.ts): it can read files and nothing more, as everything else it
 * needs from git and GitHub is in its prompt. In `dontAsk` mode, in place of Sandcastle's
 * `--dangerously-skip-permissions`, Claude Code denies whatever isn't allowed, as no one is there to ask.
 */
export function readOnlyAgent(model: string, options: FactoryAgentOptions): FactoryAgent {
  const list = (flag: string, tools: string[]) => ` ${flag} ${tools.map(shellWord).join(' ')}`
  const flags = ` --tools ${shellWord(READ_TOOLS.join(','))}${list('--allowedTools', READ_TOOLS)}${list('--disallowedTools', DENIED_TOOLS)}`
  return agentWith(
    model,
    options,
    (command, prompt, maxBudgetUsd) => ({ command: withPromptArgument(command, prompt, maxBudgetUsd, flags), stdin: '' }),
    'dontAsk',
  )
}

/** The smoke test's control: the prompt on stdin, as claudeCode() sends it, where a slash command doesn't expand. */
export function stdinAgent(model: string, options: FactoryAgentOptions): FactoryAgent {
  return agentWith(model, options, (command, prompt, maxBudgetUsd) => ({ command: `${capped(command, maxBudgetUsd)} -p -`, stdin: prompt }))
}

/** One run of an agent in the bwrap() sandbox, in a worktree whose commits are merged into the branch checked out. */
export type SandboxRun = {
  name: string
  prompt: string
  agent: FactoryAgent
  /** The checkout the worktree is made from: the current directory if not given. */
  cwd?: string
  /** Set in the sandbox, beside what bwrap() sets. */
  sandboxEnv?: Record<string, string>
  /** Copied from `cwd` into the worktree, and run in the sandbox before the agent (factory/factoryTree.ts). */
  copyToWorktree?: string[]
  hooks?: { sandbox: { onSandboxReady: { command: string; timeoutMs: number }[] } }
  copyToWorktreeMs?: number
  /** The run fails once the agent writes nothing for this long. */
  idleTimeoutSeconds: number
  /** Where Sandcastle writes its log. */
  logPath: string
  /** Each line of the agent's stream-json, as it comes. */
  onLine?: (line: string) => void
}

export type SandboxRan = {
  stdout: string
  commits: number
  /** Where the worktree was kept, as the agent left changes it didn't commit. */
  preservedWorktreePath: string | undefined
  /** Claude Code's session file, if it wrote one, for each iteration. */
  sessionFiles: (string | undefined)[]
}

/** Runs the agent once, in the sandbox. What it throws, failureOf() reads. */
export async function runInSandbox(options: SandboxRun): Promise<SandboxRan> {
  const { onLine } = options
  const ran = await run({
    name: options.name,
    prompt: options.prompt,
    agent: options.agent,
    ...(options.cwd !== undefined && { cwd: options.cwd }),
    sandbox: bwrap(options.sandboxEnv ? { env: options.sandboxEnv } : undefined),
    branchStrategy: { type: 'merge-to-head' },
    ...(options.copyToWorktree && { copyToWorktree: options.copyToWorktree }),
    ...(options.hooks && { hooks: options.hooks }),
    ...(options.copyToWorktreeMs !== undefined && { timeouts: { copyToWorktreeMs: options.copyToWorktreeMs } }),
    maxIterations: 1,
    idleTimeoutSeconds: options.idleTimeoutSeconds,
    logging: {
      type: 'file',
      path: options.logPath,
      verbose: true,
      ...(onLine && {
        onAgentStreamEvent: (event: AgentStreamEvent) => {
          if (event.type === 'raw') onLine(event.line)
        },
      }),
    },
  })
  return {
    stdout: ran.stdout,
    commits: ran.commits.length,
    preservedWorktreePath: ran.preservedWorktreePath,
    sessionFiles: ran.iterations.map(({ sessionFilePath }) => sessionFilePath),
  }
}

/** Why a run failed, in the factory's terms: the agent went quiet for too long, or anything else, with its message. */
export type SandboxFailure = { kind: 'idle-timeout'; timeoutMs: number | undefined } | { kind: 'error'; message: string }

/** What runInSandbox(), or anything before it, threw, as the factory's failure. */
export function failureOf(thrown: unknown): SandboxFailure {
  const error = sandcastleError(thrown)
  if (tagOf(error) === 'AgentIdleTimeoutError') {
    const { timeoutMs } = error as { timeoutMs?: unknown }
    return { kind: 'idle-timeout', timeoutMs: typeof timeoutMs === 'number' ? timeoutMs : undefined }
  }
  return { kind: 'error', message: error instanceof Error ? error.message : String(error) }
}

/** Where effect's FiberFailure, which Sandcastle's run() rethrows from Effect.runPromise, keeps its Cause. */
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

/**
 * The error Sandcastle failed with, out of the FiberFailure run() throws: its Cause's first failure (`Fail`'s error,
 * or `Die`'s defect, through `Sequential` and `Parallel`). Anything else is itself.
 */
function sandcastleError(thrown: unknown): unknown {
  const cause = typeof thrown === 'object' && thrown !== null ? (thrown as Record<symbol, unknown>)[FIBER_FAILURE_CAUSE] : undefined
  return cause === undefined ? thrown : (failure(cause) ?? thrown)
}

function failure(cause: unknown): unknown {
  if (typeof cause !== 'object' || cause === null) return undefined
  const node = cause as { _tag?: unknown; error?: unknown; defect?: unknown; left?: unknown; right?: unknown }
  if (node._tag === 'Fail') return node.error
  if (node._tag === 'Die') return node.defect
  if (node._tag === 'Sequential' || node._tag === 'Parallel') return failure(node.left) ?? failure(node.right)
  return undefined
}

const tagOf = (error: unknown): unknown => (typeof error === 'object' && error !== null ? (error as { _tag?: unknown })._tag : undefined)
