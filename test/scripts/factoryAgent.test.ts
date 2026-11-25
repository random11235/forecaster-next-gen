import { describe, expect, test } from 'vitest'
import { factoryAgent } from '../../scripts/factoryAgent.ts'

describe("the factory's agent", () => {
  test('runs Claude Code on the prompt from stdin, capped at the budget given', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    const print = agent.buildPrintCommand({ prompt: '/factory-smoke 42', dangerouslySkipPermissions: true })

    expect(print.command).toBe("claude --print --verbose --dangerously-skip-permissions --output-format stream-json --model 'haiku' --max-budget-usd 0.5 -p -")
    expect(print.stdin).toBe('/factory-smoke 42')
  })

  test('hands the sandbox only the OAuth token', () => {
    const agent = factoryAgent('haiku', { oauthToken: 'oauth', maxBudgetUsd: 0.5 })

    expect(agent.env).toEqual({ CLAUDE_CODE_OAUTH_TOKEN: 'oauth' })
  })
})
