// The agent the factory runs in Sandcastle: Claude Code, with the OAuth token in its env alone, a budget cap, and the
// prompt as its argument. Sandcastle 0.14.0's claudeCode() sends the prompt on stdin (`-p -`), where Claude Code doesn't
// expand a slash command such as `/implement 12`: the model gets the text and finds the skill itself, if it does (#335).
// It has no option for `--max-budget-usd` either. So this rewrites the command claudeCode() builds, which only works
// because Sandcastle is pinned at exactly 0.14.0 (docs/research/sandcastle-factory.md, section 3).
//
// The prompt will carry issue text, so it goes in as one shell word after `--`: Claude Code reads none of it as an
// option. As an argument, it's in the command line, which anything in the sandbox can read from /proc/<pid>/cmdline.

import { claudeCode, type AgentProvider } from '@ai-hero/sandcastle'
import { MAX_PROMPT_BYTES, shellWord } from './factoryShell.ts'

export { MAX_PROMPT_BYTES }

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

function agentWith(model: string, { oauthToken, maxBudgetUsd }: FactoryAgentOptions, promptOn: PromptOn, permissionMode?: 'dontAsk'): AgentProvider {
  const agent = claudeCode(model, { env: { CLAUDE_CODE_OAUTH_TOKEN: oauthToken }, ...(permissionMode && { permissionMode }) })
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

/** The only tools the agent answering a question has, all of which read files: no shell, so no `git` or `gh`. */
const READ_TOOLS = ['Read', 'Grep', 'Glob']
/** Denied outright too, though `--tools` leaves them out. */
const DENIED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch']

/**
 * The agent that answers a question (scripts/factoryAsk.ts): it can read files and nothing more, as everything else it
 * needs from git and GitHub is in its prompt. In `dontAsk` mode, in place of Sandcastle's
 * `--dangerously-skip-permissions`, Claude Code denies whatever isn't allowed, as no one is there to ask.
 */
export function readOnlyAgent(model: string, options: FactoryAgentOptions): AgentProvider {
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
export function stdinAgent(model: string, options: FactoryAgentOptions): AgentProvider {
  return agentWith(model, options, (command, prompt, maxBudgetUsd) => ({ command: `${capped(command, maxBudgetUsd)} -p -`, stdin: prompt }))
}
