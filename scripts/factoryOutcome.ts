// How the factory's build of a ticket (scripts/factoryBuild.ts) ended, as the `result` and `why` it writes to its step's
// outputs, which the `park` job of .github/workflows/factory.yml reads. Only `built` goes on to be checked and pushed.

/**
 * The build's `result`. `started` is written first, so a step left at `started` was stopped mid-run (by its timeout, or
 * killed); one with no result at all crashed before it began.
 */
export type BuildResult = 'started' | 'built' | 'no-commits' | 'dirty' | 'idle-timeout' | 'budget' | 'error'

/** How Sandcastle's `run()` ended: with the agent's commits, or with what it threw. */
export type Ending = { commits: number; preservedWorktreePath?: string | undefined } | { error: unknown }

/** Built, or a failure with why, as a park comment's reason. */
export type Outcome = { result: 'built' } | { result: Exclude<BuildResult, 'started' | 'built'>; why: string }

/** The outcome of a run that ended so, given the stream-json lines Claude Code wrote. */
export function buildOutcome(ending: Ending, transcript: readonly string[]): Outcome {
  const budget = budgetStop(transcript)
  if (budget) return { result: 'budget', why: budget }
  if ('error' in ending) {
    const error = sandcastleError(ending.error)
    if (tagOf(error) === 'AgentIdleTimeoutError') {
      const { timeoutMs } = error as { timeoutMs?: unknown }
      const quiet = typeof timeoutMs === 'number' ? `${timeoutMs / 60_000} minutes` : 'too long'
      return { result: 'idle-timeout', why: `the agent went ${quiet} without output, so Sandcastle stopped it` }
    }
    return { result: 'error', why: `the build script failed: ${error instanceof Error ? error.message : String(error)}` }
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

/** Where effect's FiberFailure, which Sandcastle's run() rethrows from Effect.runPromise, keeps its Cause. */
const FIBER_FAILURE_CAUSE = Symbol.for('effect/Runtime/FiberFailure/Cause')

/**
 * The error Sandcastle failed with, out of the FiberFailure run() throws: its Cause's first failure (`Fail`'s error,
 * or `Die`'s defect, through `Sequential` and `Parallel`). Anything else is itself.
 */
function sandcastleError(thrown: unknown): unknown {
  const cause = typeof thrown === 'object' && thrown !== null ? (thrown as Record<symbol, unknown>)[FIBER_FAILURE_CAUSE] : undefined
  return cause === undefined ? thrown : (failure(cause) ?? thrown)
}

function failure(cause: unknown): unknown {
  if (typeof cause !== 'object' || cause === null) return undefined
  const node = cause as { _tag?: unknown; error?: unknown; defect?: unknown; left?: unknown; right?: unknown }
  if (node._tag === 'Fail') return node.error
  if (node._tag === 'Die') return node.defect
  if (node._tag === 'Sequential' || node._tag === 'Parallel') return failure(node.left) ?? failure(node.right)
  return undefined
}

const tagOf = (error: unknown): unknown => (typeof error === 'object' && error !== null ? (error as { _tag?: unknown })._tag : undefined)
