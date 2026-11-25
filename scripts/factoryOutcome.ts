// How the factory's build of a ticket (scripts/factoryBuild.ts) ended, as the `result` and `why` it writes to its step's
// outputs, which the `park` job of .github/workflows/factory.yml reads. Only `built` goes on to be checked and pushed.

/**
 * The build's `result`. `started` is written first, so a step left at `started` was stopped mid-run (by its timeout, or
 * killed); one with no result at all crashed before it began.
 */
export type BuildResult = 'started' | 'built' | 'no-commits' | 'dirty' | 'idle-timeout' | 'budget' | 'error'

/** How Sandcastle's `run()` ended: with the agent's commits, or with what it threw. */
export type Ending = { commits: number; preservedWorktreePath?: string | undefined } | { error: unknown }

/** The result, and, unless it's built, why it fails, as a park comment's reason. */
export type Outcome = { result: Exclude<BuildResult, 'started'>; why?: string }

/** The outcome of a run that ended so, given the stream-json lines Claude Code wrote. */
export function buildOutcome(ending: Ending, transcript: readonly string[]): Outcome {
  const budget = budgetStop(transcript)
  if (budget) return { result: 'budget', why: budget }
  if ('error' in ending) {
    const idle = idleTimeout(ending.error)
    if (idle !== undefined)
      return {
        result: 'idle-timeout',
        why: `the agent went ${Number.isNaN(idle) ? 'too long' : `${idle / 60_000} minutes`} without output, so Sandcastle stopped it`,
      }
    return { result: 'error', why: `the build script failed: ${ending.error instanceof Error ? ending.error.message : String(ending.error)}` }
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

/** The idle timeout, in ms, if the error is Sandcastle's AgentIdleTimeoutError, itself or as a cause. */
function idleTimeout(error: unknown): number | undefined {
  for (let at = error; typeof at === 'object' && at !== null; at = (at as { cause?: unknown }).cause) {
    const { _tag, timeoutMs } = at as { _tag?: unknown; timeoutMs?: unknown }
    if (_tag === 'AgentIdleTimeoutError') return typeof timeoutMs === 'number' ? timeoutMs : Number.NaN
  }
  return undefined
}
