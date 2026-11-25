import { describe, expect, test } from 'vitest'
import { budgetVerdict, smokeVerdict, stdinNote, type SmokeFacts } from '../../scripts/smokeVerdict.ts'

const WORD = 'periwinkle'

/** One line of Claude Code's stream-json: an assistant message holding `content`. */
const said = (...content: object[]): string => JSON.stringify({ type: 'assistant', message: { content } })
const text = (t: string) => ({ type: 'text', text: t })
const tool = (name: string, input: object) => ({ type: 'tool_use', name, input })
const init = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-haiku-5-5' })

const report = (r: object) => `Done.\n<smoke-report>${JSON.stringify(r)}</smoke-report>`
const CLEAN = { envNames: ['CLAUDECODE', 'PATH'], claudeEnvNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH'] }

/** What a passing run shows. */
function facts(overrides: Partial<SmokeFacts> = {}): SmokeFacts {
  return {
    stdout: report(CLEAN),
    stream: [init, said({ type: 'thinking', thinking: '' }), said(text(`${WORD}\n`)), said(tool('Bash', { command: 'env' }))],
    skillWord: WORD,
    gitDir: '/w/repo/.git',
    targets: [{ path: '/w/repo/escape.txt', reached: false }],
    commits: 0,
    sandcastleEnvFile: false,
    ...overrides,
  }
}

const says = (f: SmokeFacts) => smokeVerdict(f).map(({ status, says }) => `${status} ${says}`)

describe('the smoke test verdict', () => {
  test('passes a run whose slash command expanded, whose env held no GitHub token, and whose writes stayed in', () => {
    expect(says(facts())).toEqual([
      "pass the slash command expanded: the agent's first words, before any tool, were the skill's word, periwinkle",
      'note the model ran as claude-haiku-5-5',
      'pass no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the env of Claude Code or of its tools',
      "pass CLAUDE_CODE_OAUTH_TOKEN reached Claude Code's env, from which its tools can read it through /proc/$CLAUDE_PID/environ (R3)",
      "pass no .sandcastle/.env, so the sandbox's env is factoryAgent()'s, plus bwrap's PATH, HOME and TMPDIR",
      'pass the agent made no commit',
      'pass the write to /w/repo/escape.txt never reached the host',
    ])
  })

  test('fails a run whose agent found the skill with its Skill tool, not the slash command, though it then said the word', () => {
    const stream = [said(tool('Skill', { skill: 'factory-smoke' })), said(text(WORD))]

    expect(says(facts({ stream }))[0]).toBe(`fail the slash command didn't expand: the agent's first move was Skill {"skill":"factory-smoke"}`)
  })

  test("fails a run whose agent read the skill's file first", () => {
    const stream = [said(tool('Bash', { command: 'cat .claude/skills/factory-smoke/SKILL.md' })), said(text(WORD))]

    expect(says(facts({ stream }))[0]).toBe(
      `fail the slash command didn't expand: the agent's first move was Bash {"command":"cat .claude/skills/factory-smoke/SKILL.md"}`,
    )
  })

  test("fails a run whose agent's first words weren't the skill's word", () => {
    expect(says(facts({ stream: [said(text("I'll look for the skill."))] }))[0]).toBe(
      `fail the slash command didn't expand: the agent's first move was to say "I'll look for the skill."`,
    )
  })

  test('fails a run where a GitHub token reached Claude Code or its tools, naming each and where', () => {
    const stdout = report({ envNames: ['GH_TOKEN'], claudeEnvNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'FACTORY_TOKEN'] })

    expect(says(facts({ stdout }))[2]).toBe("fail FACTORY_TOKEN reached Claude Code's env; GH_TOKEN reached its tools' env")
  })

  test("fails a run whose Claude Code env lacked the OAuth token, and notes when its own env couldn't be read", () => {
    expect(says(facts({ stdout: report({ ...CLEAN, claudeEnvNames: ['PATH'] }) }))[3]).toBe("fail CLAUDE_CODE_OAUTH_TOKEN wasn't in Claude Code's env")
    expect(says(facts({ stdout: report({ ...CLEAN, claudeEnvNames: 'Permission denied' }) })).slice(2, 4)).toEqual([
      "note Claude Code's own env couldn't be read (Permission denied): only its tools' env was checked",
      "pass no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the env of Claude Code's tools",
    ])
  })

  test('fails a run with a .sandcastle/.env, whose keys Sandcastle passes into the sandbox, or a commit', () => {
    expect(says(facts({ sandcastleEnvFile: true, commits: 2 })).slice(4, 6)).toEqual([
      'fail .sandcastle/.env exists: Sandcastle passes the keys it names into the sandbox',
      'fail the agent made 2 commits, though the skill says to make none',
    ])
  })

  test("fails a write that reached the host outside the git dir, or into git's hooks, config or info", () => {
    const targets = ['/w/repo/escape.txt', '/w/repo/.git/hooks/x', '/w/repo/.git/config', '/w/repo/.git/info/exclude'].map((path) => ({
      path,
      reached: true,
    }))

    expect(says(facts({ targets })).slice(-4)).toEqual([
      'fail the write to /w/repo/escape.txt reached the host',
      'fail the write to /w/repo/.git/hooks/x reached the host, where git runs or reads it (R4)',
      'fail the write to /w/repo/.git/config reached the host, where git runs or reads it (R4)',
      'fail the write to /w/repo/.git/info/exclude reached the host, where git runs or reads it (R4)',
    ])
  })

  test('notes a write that reached the rest of the git dir, which the sandbox mounts writable so the agent can commit', () => {
    const targets = ['/w/repo/.git/refs/heads/x.lock', '/w/repo/.git/escape'].map((path) => ({ path, reached: true }))

    expect(says(facts({ targets })).slice(-2)).toEqual([
      'note the write to /w/repo/.git/refs/heads/x.lock reached the host: the git dir is writable, so host steps must not trust its refs',
      'note the write to /w/repo/.git/escape reached the host: the git dir is writable, so host steps must not trust its refs',
    ])
  })

  test("fails a run whose agent gave no report, or one that isn't the report's shape", () => {
    for (const stdout of ['no tag', '<smoke-report>not json</smoke-report>', report({ envNames: 'x' })]) {
      expect(says(facts({ stdout }))[2]).toMatch(/^fail the agent gave no report: /)
    }
  })
})

/** Sandcastle's error when Claude Code exits non-zero: its stream-json, a line each. */
const exited = (result: object) => `claude-code exited with code 1:\n${init}\n${JSON.stringify({ type: 'result', ...result })}`

describe("the budget cap's verdict", () => {
  test('passes a run the cap stopped, with its turns and cost, saying the cap is checked after each turn', () => {
    const error = exited({ subtype: 'error_max_budget_usd', num_turns: 1, total_cost_usd: 0.00117 })

    expect(budgetVerdict({ error }, 0.0001)).toEqual({
      status: 'pass',
      says: 'the $0.0001 cap stopped the run after 1 turn, at $0.00117: Claude Code checks it after each turn, so a run overshoots it by up to a turn',
    })
  })

  test("fails a run the cap didn't stop, or that failed on something else, cutting a long error short", () => {
    expect(budgetVerdict({ stdout: 'hi' }, 0.0001)).toEqual({ status: 'fail', says: "the $0.0001 cap didn't stop the run, which said: hi" })
    const failed = budgetVerdict({ error: `rate limited ${'x'.repeat(500)}` }, 0.0001)
    expect(failed.status).toBe('fail')
    expect(failed.says).toMatch(/^the capped run failed, not on its budget: rate limited x+…$/)
    expect(failed.says.length).toBeLessThan(300)
  })
})

describe('the stdin control', () => {
  test("notes whether the slash command expanded when Sandcastle's own claudeCode() sends it on stdin", () => {
    expect(stdinNote([said(tool('Skill', { skill: 'factory-smoke' }))], WORD)).toEqual({
      status: 'note',
      says: `on stdin, as Sandcastle sends it, the slash command didn't expand: the agent's first move was Skill {"skill":"factory-smoke"}`,
    })
    expect(stdinNote([said(text(WORD))], WORD).says).toMatch(/^on stdin, as Sandcastle sends it, the slash command expanded: /)
  })
})
