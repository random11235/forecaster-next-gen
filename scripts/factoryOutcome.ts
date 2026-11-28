// How the factory's build of a ticket (scripts/factoryBuild.ts) ended, as the `result` and `why` it writes to its step's
// outputs, which the `park` job of .github/workflows/factory.yml reads. Only `built` goes on to be checked and pushed.

import { failureOf } from './factorySandcastle.ts'

/**
 * The build's `result`. `started` is written first, so a step left at `started` was stopped mid-run (by its timeout, or
 * killed); one with no result at all crashed before it began.
 */
export type BuildResult = 'started' | 'built' | 'no-commits' | 'dirty' | 'idle-timeout' | 'budget' | 'unbuildable' | 'error'

/** Why the factory won't build on the branch (scripts/factoryTree.ts): its fault, not the build's, so building again won't help. */
export class UnbuildableTree extends Error {
  override name = 'UnbuildableTree'
}

/** How the build ended: with the agent's commits, or with what readying the tree or the sandbox's run threw (scripts/factorySandcastle.ts). */
export type Ending = { commits: number; preservedWorktreePath?: string | undefined } | { error: unknown }

/** Built, or a failure with why, as a park comment's reason. */
export type Outcome = { result: 'built' } | { result: Exclude<BuildResult, 'started' | 'built'>; why: string }

/** The outcome of a run that ended so, given the stream-json lines Claude Code wrote. */
export function buildOutcome(ending: Ending, transcript: readonly string[]): Outcome {
  const budget = budgetStop(transcript)
  if (budget) return { result: 'budget', why: budget }
  if ('error' in ending) {
    if (ending.error instanceof UnbuildableTree) return { result: 'unbuildable', why: ending.error.message }
    const failure = failureOf(ending.error)
    if (failure.kind === 'idle-timeout') {
      const quiet = failure.timeoutMs === undefined ? 'too long' : `${failure.timeoutMs / 60_000} minutes`
      return { result: 'idle-timeout', why: `the agent went ${quiet} without output, so Sandcastle stopped it` }
    }
    return { result: 'error', why: `the build script failed: ${failure.message}` }
  }
  if (ending.commits === 0) return { result: 'no-commits', why: 'the agent made no commit' }
  if (ending.preservedWorktreePath) return { result: 'dirty', why: "the agent left changes it didn't commit" }
  return { result: 'built' }
}

/** Why `--max-budget-usd` stopped the run, if Claude Code's result says it did: `error_max_budget_usd`. */
function budgetStop(transcript: readonly string[]): string | undefined {
  const result = transcript.map(parse).find((event) => event?.type === 'result')
  if (result?.subtype !== 'error_max_budget_usd') return undefined
  return `the budget stopped the agent, after ${String(result.num_turns)} turns at $${String(result.total_cost_usd)}`
}

const parse = (line: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}
