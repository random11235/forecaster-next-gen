// Every repo-specific value the factory's scripts use, read from the environment .github/workflows/factory.yml sets at
// its top level, where each has its default: the one place they are written. A value left unset fails the script,
// naming it, rather than run the factory on a guess. The workflow's own settings that no script reads (the Node version,
// the job and agent time limits) are set there too.
//
// It imports nothing, as factory/factoryAsked.ts reads it before the workflow installs anything
// (factory/test/factoryAsked.test.ts).

export type FactoryConfig = {
  /** The label that starts a build, which the factory takes off once it starts. */
  triggerLabel: string
  /** The label on a ticket the factory failed to build. */
  parkedLabel: string
  /** The label on a ticket being built. */
  inProgressLabel: string
  /** The hidden mark every comment the factory makes carries (factory/factoryTrust.ts). */
  mark: string
  /** The hidden mark triage's brief for a ticket opens with. */
  briefMark: string
  /** What installs the repo's dependencies, on the runner and in the sandbox. */
  installCommand: string
  /** What the factory runs on the agent's commits before it publishes them. */
  checkCommand: string
  /** The skills a build's agent needs, which the runner must have installed before it runs. */
  requiredSkills: string[]
  /** The build's model, and the spend after which Claude Code stops. */
  model: string
  budgetUsd: number
  /** The mention that asks the factory a question, `@claude`: GitHub's logins ignore case. */
  mention: string
  /** A question's model, its spend cap, how long its agent may sit idle, and how many commits its prompt lists. */
  askModel: string
  askBudgetUsd: number
  askIdleSeconds: number
  askCommits: number
}

type Env = Readonly<Record<string, string | undefined>>

/** The factory's config from the environment, or a throw naming the first value that's unset or isn't a number. */
export function factoryConfig(env: Env = process.env): FactoryConfig {
  const text = (name: string): string => {
    const value = env[name]
    if (!value) throw new Error(`${name} is not set`)
    return value
  }
  const number = (name: string): number => {
    const value = Number(text(name))
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} is not a positive number: ${text(name)}`)
    return value
  }
  return {
    triggerLabel: text('TRIGGER_LABEL'),
    parkedLabel: text('PARKED_LABEL'),
    inProgressLabel: text('IN_PROGRESS_LABEL'),
    mark: text('MARK'),
    briefMark: text('BRIEF_MARK'),
    installCommand: text('INSTALL_COMMAND'),
    checkCommand: text('CHECK_COMMAND'),
    requiredSkills: text('REQUIRED_SKILLS').split(/\s+/).filter(Boolean),
    model: text('MODEL'),
    budgetUsd: number('BUDGET_USD'),
    mention: text('MENTION'),
    askModel: text('ASK_MODEL'),
    askBudgetUsd: number('ASK_BUDGET_USD'),
    askIdleSeconds: number('ASK_IDLE_SECONDS'),
    askCommits: number('ASK_COMMITS'),
  }
}
