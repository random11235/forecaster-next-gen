import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildOutcome } from '../factoryOutcome.ts'
import { factoryAgent, MAX_PROMPT_BYTES, readOnlyAgent, sandcastleRun, stdinAgent, withPromptArgument } from '../factorySandcastle.ts'
// Sandcastle 0.14.0 bundles effect and doesn't export its errors: these are its own, as its run() throws them, from
// Effect.runPromise. A Sandcastle bump renames the chunks, so this import fails rather than tests a stale shape.
// @ts-expect-error -- a bundle chunk, with no types
import { AgentError, AgentIdleTimeoutError } from '../../node_modules/@ai-hero/sandcastle/dist/chunk-RDW7FNN6.js'
// @ts-expect-error -- a bundle chunk, with no types
import { Effect_exports as Effect } from '../../node_modules/@ai-hero/sandcastle/dist/chunk-STB2U7BB.js'

const COMMAND = "claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model 'haiku'"

/** A stand-in `claude` on PATH that prints the arguments it got, as JSON. */
function standIn(): string {
  const dir = mkdtempSync(join(tmpdir(), 'factory-agent-'))
  writeFileSync(join(dir, 'claude'), '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)))\n')
  chmodSync(join(dir, 'claude'), 0o755)
  return dir
}

/** The arguments `claude` gets when the shell runs `command`, as Sandcastle does. */
function argvOf(command: string, dir: string): string[] {
  const out = execFileSync('sh', ['-c', command], { env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ''}` }, encoding: 'utf8' })
  return JSON.parse(out) as string[]
}

describe("the factory's agent", () => {
  test('runs Claude Code on the prompt as its argument, after --, where a slash command expands, capped at the budget given', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    const print = agent.buildPrintCommand({ prompt: '/factory-smoke 42', dangerouslySkipPermissions: true })

    expect(print.command).toBe(`${COMMAND} --max-budget-usd 0.5 -p -- '/factory-smoke 42'`)
    expect(print.stdin).toBe('')
  })

  test('hands Claude Code any prompt unchanged, as one argument after --, through the shell', () => {
    const dir = standIn()
    const prompts = ["it's", 'a "quote"', '$(touch x)', '`id`', 'line\nnext', 'cost is $$5', "$& $` $'", '-p --bare', '--', '']

    for (const prompt of prompts) {
      const argv = argvOf(
        factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 }).buildPrintCommand({ prompt, dangerouslySkipPermissions: true }).command,
        dir,
      )

      expect(argv.slice(-4)).toEqual(['0.5', '-p', '--', prompt])
    }
  })

  test("refuses a prompt too long for the shell's command line, which Linux caps at 128 KiB", () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    expect(() => agent.buildPrintCommand({ prompt: 'x'.repeat(MAX_PROMPT_BYTES + 1), dangerouslySkipPermissions: true })).toThrow(
      `the prompt, quoted for the shell, is ${MAX_PROMPT_BYTES + 3} bytes, more than the ${MAX_PROMPT_BYTES} a command line can safely hold`,
    )
    expect(() => agent.buildPrintCommand({ prompt: 'é'.repeat(MAX_PROMPT_BYTES / 2 + 1), dangerouslySkipPermissions: true })).toThrow(
      /^the prompt, quoted for the shell, is 100004 bytes/,
    )
  })

  test('refuses a prompt holding a NUL byte, which no command line can carry', () => {
    expect(() => withPromptArgument(`${COMMAND} -p -`, 'a\0b', 0.5)).toThrow('the prompt holds a NUL byte, which no command line can carry')
  })

  test("throws if Sandcastle's command no longer ends in -p -, since only a Sandcastle bump would change it", () => {
    expect(() => withPromptArgument('claude --print -p "x"', 'hi', 0.5)).toThrow(`claudeCode()'s command no longer ends in -p -: claude --print -p "x"`)
  })

  test("the smoke test's control sends the prompt on stdin, Sandcastle's own way, with the same cap and env", () => {
    const agent = stdinAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.1 })

    const print = agent.buildPrintCommand({ prompt: '/factory-smoke', dangerouslySkipPermissions: true })

    expect(print.command).toBe(`${COMMAND} --max-budget-usd 0.1 -p -`)
    expect(print.stdin).toBe('/factory-smoke')
    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
  })

  test('answering a question, has only the file-reading tools, no shell, and only the OAuth token in its env', () => {
    const agent = readOnlyAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 2 })

    const { command } = agent.buildPrintCommand({ prompt: 'Is it done?', dangerouslySkipPermissions: true })

    expect(command).toBe(
      "claude --print --verbose --permission-mode dontAsk --output-format stream-json --model 'haiku' --tools 'Read,Grep,Glob' --allowedTools 'Read' 'Grep' 'Glob'" +
        " --disallowedTools 'Bash' 'Edit' 'Write' 'NotebookEdit' 'WebFetch' 'WebSearch' --max-budget-usd 2 -p -- 'Is it done?'",
    )
    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
  })

  test('hands the sandbox only the OAuth token', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
  })
})

describe("a run in the sandbox, as Sandcastle's run() takes it", () => {
  const RUN = {
    name: 'ticket-42',
    prompt: 'hi',
    agent: factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 }),
    idleTimeoutSeconds: 60,
    logPath: 'log',
  }

  test("installs in the sandbox, before the agent, as Sandcastle's sandbox onSandboxReady hook, and copies the files into the worktree", () => {
    const options = sandcastleRun({ ...RUN, copyToWorktree: ['.claude/skills'], installInSandbox: { command: 'npm ci', timeoutMs: 600_000 } })

    expect(options.hooks).toEqual({ sandbox: { onSandboxReady: [{ command: 'npm ci', timeoutMs: 600_000 }] } })
    expect(options.copyToWorktree).toEqual(['.claude/skills'])
  })

  test('installs nothing and copies nothing when not asked to', () => {
    const options = sandcastleRun(RUN)

    expect(options.hooks).toBeUndefined()
    expect(options.copyToWorktree).toBeUndefined()
  })
})

/** What Sandcastle's run() rejects with when its Effect fails with `error`. */
async function rejection(error: unknown): Promise<unknown> {
  return (Effect.runPromise(Effect.fail(error)) as Promise<never>).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
}

describe("the factory build's outcome, from what Sandcastle's run() threw", () => {
  test('is idle-timeout when Sandcastle stopped an agent that went quiet, from the FiberFailure run() rethrows', async () => {
    const thrown = await rejection(new AgentIdleTimeoutError({ message: 'Agent idle for 1200 seconds', timeoutMs: 1_200_000 }))

    expect(buildOutcome({ error: thrown }, [])).toEqual({
      result: 'idle-timeout',
      why: 'the agent went 20 minutes without output, so Sandcastle stopped it',
    })
  })

  test("is error for any other failure, with its message, Sandcastle's unwrapped from its FiberFailure", async () => {
    const thrown = await rejection(new AgentError({ message: 'claude exited 1' }))

    expect(buildOutcome({ error: thrown }, [])).toEqual({ result: 'error', why: 'the build script failed: claude exited 1' })
    expect(buildOutcome({ error: new Error('merge failed') }, [])).toEqual({ result: 'error', why: 'the build script failed: merge failed' })
    expect(buildOutcome({ error: 'odd' }, [])).toEqual({ result: 'error', why: 'the build script failed: odd' })
  })
})

test('is the only script that imports Sandcastle, and its test the only test', () => {
  const importers = ['factory', 'factory/test', 'scripts', 'test/scripts'].flatMap((dir) =>
    readdirSync(new URL(`../../${dir}`, import.meta.url))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `${dir}/${name}`)
      .filter((path) => /^import[^'"]*?from '[^']*@ai-hero\/sandcastle/m.test(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'))),
  )

  expect(importers.sort()).toEqual(['factory/factorySandcastle.ts', 'factory/test/factorySandcastle.test.ts'])
})
