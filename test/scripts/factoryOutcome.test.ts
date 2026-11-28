import { describe, expect, test } from 'vitest'
import { buildOutcome, UnbuildableTree } from '../../scripts/factoryOutcome.ts'

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

  test("is unbuildable when the branch it builds on holds what the factory won't build on, saying what", () => {
    expect(buildOutcome({ error: new UnbuildableTree('the branch holds node_modules') }, [])).toEqual({
      result: 'unbuildable',
      why: 'the branch holds node_modules',
    })
  })
})
