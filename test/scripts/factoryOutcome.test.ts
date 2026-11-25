import { describe, expect, test } from 'vitest'
import { buildOutcome } from '../../scripts/factoryOutcome.ts'
import { UnbuildableTree } from '../../scripts/factoryTree.ts'
// Sandcastle 0.14.0 bundles effect and doesn't export its errors: these are its own, as its run() throws them, from
// Effect.runPromise. A Sandcastle bump renames the chunks, so this import fails rather than tests a stale shape.
// @ts-expect-error -- a bundle chunk, with no types
import { AgentError, AgentIdleTimeoutError } from '../../node_modules/@ai-hero/sandcastle/dist/chunk-RDW7FNN6.js'
// @ts-expect-error -- a bundle chunk, with no types
import { Effect_exports as Effect } from '../../node_modules/@ai-hero/sandcastle/dist/chunk-STB2U7BB.js'

/** What Sandcastle's run() rejects with when its Effect fails with `error`. */
async function rejection(error: unknown): Promise<unknown> {
  return (Effect.runPromise(Effect.fail(error)) as Promise<never>).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
}

const result = (subtype: string) => JSON.stringify({ type: 'result', subtype, num_turns: 9, total_cost_usd: 25.4 })

describe("the factory build's outcome", () => {
  test('is built when the agent made commits and left nothing uncommitted', () => {
    expect(buildOutcome({ commits: 2 }, [result('success')])).toEqual({ result: 'built' })
  })

  test('is no-commits, or dirty, saying why', () => {
    expect(buildOutcome({ commits: 0 }, [])).toEqual({ result: 'no-commits', why: 'the agent made no commit' })
    expect(buildOutcome({ commits: 1, preservedWorktreePath: '/w/t' }, [])).toEqual({
      result: 'dirty',
      why: "the agent left changes it didn't commit",
    })
  })

  test("is budget when Claude Code's result says the budget stopped it, though it made commits or the run failed", () => {
    const budget = { result: 'budget', why: 'the budget stopped the agent, after 9 turns at $25.4' }

    expect(buildOutcome({ commits: 1 }, ['{"type":"system"}', result('error_max_budget_usd')])).toEqual(budget)
    expect(buildOutcome({ error: new Error('agent exited 1') }, [result('error_max_budget_usd'), 'not json'])).toEqual(budget)
  })

  test('is idle-timeout when Sandcastle stopped an agent that went quiet, from the FiberFailure run() rethrows', async () => {
    const thrown = await rejection(new AgentIdleTimeoutError({ message: 'Agent idle for 1200 seconds', timeoutMs: 1_200_000 }))

    expect(buildOutcome({ error: thrown }, [])).toEqual({
      result: 'idle-timeout',
      why: 'the agent went 20 minutes without output, so Sandcastle stopped it',
    })
  })

  test("is unbuildable when the branch it builds on holds what the factory won't build on, saying what", () => {
    expect(buildOutcome({ error: new UnbuildableTree('the branch holds node_modules') }, [])).toEqual({
      result: 'unbuildable',
      why: 'the branch holds node_modules',
    })
  })

  test("is error for any other failure, with its message, Sandcastle's unwrapped from its FiberFailure", async () => {
    const thrown = await rejection(new AgentError({ message: 'claude exited 1' }))

    expect(buildOutcome({ error: thrown }, [])).toEqual({ result: 'error', why: 'the build script failed: claude exited 1' })
    expect(buildOutcome({ error: new Error('merge failed') }, [])).toEqual({ result: 'error', why: 'the build script failed: merge failed' })
    expect(buildOutcome({ error: 'odd' }, [])).toEqual({ result: 'error', why: 'the build script failed: odd' })
  })
})
