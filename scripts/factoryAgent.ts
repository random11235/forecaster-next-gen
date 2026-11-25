// The agent the factory runs in Sandcastle: Claude Code, with the OAuth token in its env alone and a budget cap.
// Sandcastle 0.14.0's claudeCode() has no option for `--max-budget-usd`, so this adds it to the command claudeCode()
// builds, before the trailing `-p -` that reads the prompt from stdin (docs/research/sandcastle-factory.md, section 3).

import { claudeCode, type AgentProvider } from '@ai-hero/sandcastle'

export type FactoryAgentOptions = {
  /** CLAUDE_CODE_OAUTH_TOKEN, the one secret the sandbox gets. */
  oauthToken: string
  /** Claude Code stops once a run's cost, as it reckons it, passes this many dollars. */
  maxBudgetUsd: number
}

const STDIN_PROMPT = / -p -$/

export function factoryAgent(model: string, { oauthToken, maxBudgetUsd }: FactoryAgentOptions): AgentProvider {
  const agent = claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } })
  return {
    ...agent,
    buildPrintCommand(options) {
      const print = agent.buildPrintCommand(options)
      if (!STDIN_PROMPT.test(print.command)) throw new Error(`claudeCode()'s command no longer ends in -p -: ${print.command}`)
      return { ...print, command: print.command.replace(STDIN_PROMPT, ` --max-budget-usd ${maxBudgetUsd} -p -`) }
    },
  }
}
