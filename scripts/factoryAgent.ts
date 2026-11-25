// The agent the factory runs in Sandcastle: Claude Code, with the OAuth token in its env alone, a budget cap, and the
// prompt as its argument. Sandcastle 0.14.0's claudeCode() sends the prompt on stdin (`-p -`), where Claude Code doesn't
// expand a slash command such as `/implement 12`: the model gets the text and finds the skill itself, if it does (#335).
// It has no option for `--max-budget-usd` either. So this rewrites the command claudeCode() builds, which only works
// because Sandcastle is pinned at exactly 0.14.0 (docs/research/sandcastle-factory.md, section 3).

import { claudeCode, type AgentProvider } from '@ai-hero/sandcastle'

export type FactoryAgentOptions = {
  /** CLAUDE_CODE_OAUTH_TOKEN, the one secret the sandbox gets. */
  oauthToken: string
  /** Claude Code stops once a run's cost, as it reckons it after each turn, passes this many dollars. */
  maxBudgetUsd: number
  /** `argv` (the default) expands a slash command; `stdin`, Sandcastle's own way, is kept to show it doesn't. */
  promptOn?: 'argv' | 'stdin'
}

const STDIN_PROMPT = / -p -$/

/** `text` as one shell word, in single quotes. */
const quoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`

export function factoryAgent(model: string, { oauthToken, maxBudgetUsd, promptOn = 'argv' }: FactoryAgentOptions): AgentProvider {
  const agent = claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } })
  return {
    ...agent,
    buildPrintCommand(options) {
      const print = agent.buildPrintCommand(options)
      if (!STDIN_PROMPT.test(print.command)) throw new Error(`claudeCode()'s command no longer ends in -p -: ${print.command}`)
      const budget = ` --max-budget-usd ${maxBudgetUsd}`
      if (promptOn === 'stdin') return { ...print, command: print.command.replace(STDIN_PROMPT, `${budget} -p -`) }
      return { command: print.command.replace(STDIN_PROMPT, `${budget} -p ${quoted(options.prompt)}`), stdin: '' }
    },
  }
}
