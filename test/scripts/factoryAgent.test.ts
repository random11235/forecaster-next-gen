import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { factoryAgent, MAX_PROMPT_BYTES, withPromptArgument } from '../../scripts/factoryAgent.ts'

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

  test("throws if Sandcastle's command no longer ends in -p -, since only a Sandcastle bump would change it", () => {
    expect(() => withPromptArgument('claude --print -p "x"', 'hi', 0.5)).toThrow(`claudeCode()'s command no longer ends in -p -: claude --print -p "x"`)
  })

  test('hands the sandbox only the OAuth token', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
  })
})
