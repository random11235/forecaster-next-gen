import { describe, expect, test } from 'vitest'
import { buildOutcome } from '../../scripts/factoryOutcome.ts'

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

  test("is idle-timeout when Sandcastle stopped an agent that went quiet, however it's wrapped", () => {
    const idle = { _tag: 'AgentIdleTimeoutError', timeoutMs: 1_200_000, message: 'Agent idle for 1200 seconds' }
    const why = 'the agent went 20 minutes without output, so Sandcastle stopped it'

    expect(buildOutcome({ error: idle }, [])).toEqual({ result: 'idle-timeout', why })
    expect(buildOutcome({ error: Object.assign(new Error('wrapped'), { cause: idle }) }, [])).toEqual({ result: 'idle-timeout', why })
  })

  test('is error for any other failure, with its message', () => {
    expect(buildOutcome({ error: new Error('merge failed') }, [])).toEqual({ result: 'error', why: 'the build script failed: merge failed' })
    expect(buildOutcome({ error: 'odd' }, [])).toEqual({ result: 'error', why: 'the build script failed: odd' })
  })
})
