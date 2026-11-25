import { describe, expect, test } from 'vitest'
import { factoryAgent } from '../../scripts/factoryAgent.ts'

const COMMAND = "claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model 'haiku'"

describe("the factory's agent", () => {
  test('runs Claude Code on the prompt as its argument, where a slash command expands, capped at the budget given', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    const print = agent.buildPrintCommand({ prompt: '/factory-smoke 42', dangerouslySkipPermissions: true })

    expect(print.command).toBe(`${COMMAND} --max-budget-usd 0.5 -p '/factory-smoke 42'`)
    expect(print.stdin).toBe('')
  })

  test('quotes the prompt for the shell, whatever it holds', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    const print = agent.buildPrintCommand({ prompt: "it's $HOME `x`", dangerouslySkipPermissions: true })

    expect(print.command).toBe(`${COMMAND} --max-budget-usd 0.5 -p 'it'\\''s $HOME \`x\`'`)
  })

  test("can send the prompt on stdin, Sandcastle's own way, where a slash command doesn't expand", () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5, promptOn: 'stdin' })

    const print = agent.buildPrintCommand({ prompt: '/factory-smoke 42', dangerouslySkipPermissions: true })

    expect(print.command).toBe(`${COMMAND} --max-budget-usd 0.5 -p -`)
    expect(print.stdin).toBe('/factory-smoke 42')
  })

  test('hands the sandbox only the OAuth token', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
  })
})
