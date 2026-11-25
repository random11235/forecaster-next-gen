// The agent the factory runs in Sandcastle: Claude Code, with the OAuth token in its env alone, a budget cap, and the
// prompt as its argument. Sandcastle 0.14.0's claudeCode() sends the prompt on stdin (`-p -`), where Claude Code doesn't
// expand a slash command such as `/implement 12`: the model gets the text and finds the skill itself, if it does (#335).
// It has no option for `--max-budget-usd` either. So this rewrites the command claudeCode() builds, which only works
// because Sandcastle is pinned at exactly 0.14.0 (docs/research/sandcastle-factory.md, section 3).
//
// The prompt will carry issue text, so it goes in as one shell word after `--`: Claude Code reads none of it as an
// option. As an argument, it's in the command line, which anything in the sandbox can read from /proc/<pid>/cmdline.

import { claudeCode, type AgentProvider } from '@ai-hero/sandcastle'

export type FactoryAgentOptions = {
  /** CLAUDE_CODE_OAUTH_TOKEN, the one secret the sandbox gets. */
  oauthToken: string
  /** Claude Code stops once a run's cost, as it reckons it after each turn, passes this many dollars. */
  maxBudgetUsd: number
}

/** Linux caps one argument, and so Sandcastle's whole `sh -c` command, at 128 KiB; this leaves room for the rest. */
export const MAX_PROMPT_BYTES = 100_000

const STDIN_PROMPT = ' -p -'

/** `text` as one shell word, in single quotes. */
const quoted = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`

/** The part of claudeCode()'s `command` before its closing `-p -`, which it throws without, plus the budget cap. */
function capped(command: string, maxBudgetUsd: number): string {
  if (!command.endsWith(STDIN_PROMPT)) throw new Error(`claudeCode()'s command no longer ends in -p -: ${command}`)
  return `${command.slice(0, -STDIN_PROMPT.length)} --max-budget-usd ${maxBudgetUsd}`
}

/** claudeCode()'s `command`, which ends in `-p -`, with the budget cap and `prompt` as the argument in its place. */
export function withPromptArgument(command: string, prompt: string, maxBudgetUsd: number): string {
  const start = capped(command, maxBudgetUsd)
  if (prompt.includes('\0')) throw new Error('the prompt holds a NUL byte, which no command line can carry')
  const word = quoted(prompt)
  const bytes = Buffer.byteLength(word)
  if (bytes > MAX_PROMPT_BYTES) {
    throw new Error(`the prompt, quoted for the shell, is ${bytes} bytes, more than the ${MAX_PROMPT_BYTES} a command line can safely hold`)
  }
  return `${start} -p -- ${word}`
}

type PromptOn = (command: string, prompt: string, maxBudgetUsd: number) => { command: string; stdin: string }

function agentWith(model: string, { oauthToken, maxBudgetUsd }: FactoryAgentOptions, promptOn: PromptOn): AgentProvider {
  const agent = claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken } })
  return {
    ...agent,
    buildPrintCommand(options) {
      return promptOn(agent.buildPrintCommand(options).command, options.prompt, maxBudgetUsd)
    },
  }
}

export function factoryAgent(model: string, options: FactoryAgentOptions): AgentProvider {
  return agentWith(model, options, (command, prompt, maxBudgetUsd) => ({ command: withPromptArgument(command, prompt, maxBudgetUsd), stdin: '' }))
}

/** The smoke test's control: the prompt on stdin, as claudeCode() sends it, where a slash command doesn't expand. */
export function stdinAgent(model: string, options: FactoryAgentOptions): AgentProvider {
  return agentWith(model, options, (command, prompt, maxBudgetUsd) => ({ command: `${capped(command, maxBudgetUsd)} -p -`, stdin: prompt }))
}
