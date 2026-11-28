import { describe, expect, test } from 'vitest'
import { budgetVerdict, controlWrites, smokeVerdict, stdinNote, type SmokeFacts } from '../smokeVerdict.ts'

const WORD = 'periwinkle'

/** One line of Claude Code's stream-json: an assistant message holding `content`. */
const said = (...content: object[]): string => JSON.stringify({ type: 'assistant', message: { content } })
const text = (t: string) => ({ type: 'text', text: t })
const tool = (name: string, input: object) => ({ type: 'tool_use', name, input })
const init = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-haiku-5-5' })

const report = (r: object) => `Done.\n<smoke-report>${JSON.stringify(r)}</smoke-report>`
const CLEAN = {
  envNames: ['CLAUDECODE', 'PATH'],
  claudeEnvNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'HOME', 'PATH'],
  writes: { '/w/repo/escape.txt': 'ok', '/usr/local/escape.txt': 'Read-only file system' },
}

/** What a passing run shows. */
function facts(overrides: Partial<SmokeFacts> = {}): SmokeFacts {
  return {
    stdout: report(CLEAN),
    stream: [init, said({ type: 'thinking', thinking: '' }), said(text(`${WORD}\n`)), said(tool('Bash', { command: 'env' }))],
    skillWord: WORD,
    gitDir: '/w/repo/.git',
    writes: [
      { path: '/w/repo/escape.txt', changedOnHost: false },
      { path: '/usr/local/escape.txt', changedOnHost: false },
      { path: '/w/_temp/escape.txt', changedOnHost: false, about: 'which tests only that the sandbox hides RUNNER_TEMP' },
    ],
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
      "pass no .sandcastle/.env, so the sandbox's env is factoryAgent()'s, plus bwrap's HOME, PATH, PWD and TMPDIR",
      'pass the agent made no commit',
      "pass the write to /w/repo/escape.txt worked inside the sandbox, landing in the sandbox's own files, and never reached the host",
      'pass the write to /usr/local/escape.txt failed inside the sandbox (Read-only file system), and never reached the host',
      'pass the write to /w/_temp/escape.txt never reached the host, which tests only that the sandbox hides RUNNER_TEMP',
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

  test('passes a run whose first words were the skill word in light markdown', () => {
    for (const words of [`**${WORD}**`, `\`${WORD}\``, `# ${WORD}`, `_${WORD}_ next`]) {
      expect(says(facts({ stream: [said(text(words))] }))[0]).toMatch(/^pass /)
    }
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
    for (const [claudeEnvNames, why] of [
      ['Permission denied', 'Permission denied'],
      [[], 'it listed no names'],
    ] as const) {
      expect(says(facts({ stdout: report({ ...CLEAN, claudeEnvNames }) })).slice(2, 4)).toEqual([
        `note Claude Code's own env couldn't be read (${why}): only its tools' env was checked`,
        "pass no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the env of Claude Code's tools",
      ])
    }
  })

  test('fails a run with a .sandcastle/.env, whose keys Sandcastle passes into the sandbox, or a commit', () => {
    expect(says(facts({ sandcastleEnvFile: true, commits: 2 })).slice(4, 6)).toEqual([
      'fail .sandcastle/.env exists: Sandcastle passes the keys it names into the sandbox',
      'fail the agent made 2 commits, though the skill says to make none',
    ])
  })

  test("fails a write that reached the host outside the git dir, or into git's hooks, config or info", () => {
    const writes = ['/w/repo/escape.txt', '/w/repo/.git/hooks/x', '/w/repo/.git/config', '/w/repo/.git/info/exclude'].map((path) => ({
      path,
      changedOnHost: true,
    }))

    expect(says(facts({ writes })).slice(-4)).toEqual([
      'fail the write to /w/repo/escape.txt reached the host',
      'fail the write to /w/repo/.git/hooks/x reached the host, where git runs or reads it (R4)',
      'fail the write to /w/repo/.git/config reached the host, where git runs or reads it (R4)',
      'fail the write to /w/repo/.git/info/exclude reached the host, where git runs or reads it (R4)',
    ])
  })

  test('notes a write that reached the rest of the git dir, which the sandbox mounts writable so the agent can commit', () => {
    const writes = ['/w/repo/.git/refs/heads/x.lock', '/w/repo/.git/escape'].map((path) => ({ path, changedOnHost: true }))
    const why =
      'the sandbox mounts the git dir writable, so the agent can rewrite HEAD, packed-refs, refs and objects (objects/info/alternates too), and no host step may trust them'

    expect(says(facts({ writes })).slice(-2)).toEqual([
      `note the write to /w/repo/.git/refs/heads/x.lock reached the host, outside the agent's tree: ${why}`,
      `note the write to /w/repo/.git/escape reached the host, outside the agent's tree: ${why}`,
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

  test("says so when Claude Code's result leaves out its turns or cost", () => {
    expect(budgetVerdict({ error: exited({ subtype: 'error_max_budget_usd' }) }, 0.0001).says).toMatch(
      /^the \$0.0001 cap stopped the run after an unreported number of turns, at an unreported cost: /,
    )
  })
})

describe('the stdin control', () => {
  test("notes whether the slash command expanded when Sandcastle's own claudeCode() sends it on stdin", () => {
    expect(stdinNote([said(tool('Skill', { skill: 'factory-smoke' }))], WORD)).toEqual({
      status: 'note',
      says:
        `on stdin, as Sandcastle's claudeCode() sends it, the slash command didn't expand: the agent's first move was Skill {"skill":"factory-smoke"}; ` +
        "so factoryAgent() passes the prompt as Claude Code's argument instead",
    })
    expect(stdinNote([said(text(WORD))], WORD).says).toMatch(
      /^on stdin, as Sandcastle's claudeCode\(\) sends it, the slash command expanded: .*; so the prompt needn't be Claude Code's argument$/,
    )
  })

  test("judges the writes its agent got to the host as the smoke run's are judged, and says nothing of the rest", () => {
    const writes = [
      { path: '/w/repo/escape.txt', changedOnHost: true },
      { path: '/w/repo/.git/hooks/x', changedOnHost: true },
      { path: '/w/repo/.git/refs/heads/x.lock', changedOnHost: true },
      { path: '/w/repo/.git/config', changedOnHost: false },
    ]

    expect(controlWrites(writes, '/w/repo/.git').map(({ status, says }) => `${status} ${says}`)).toEqual([
      "fail the stdin control's agent's write to /w/repo/escape.txt reached the host",
      "fail the stdin control's agent's write to /w/repo/.git/hooks/x reached the host, where git runs or reads it (R4)",
      expect.stringMatching(/^note the stdin control's agent's write to \/w\/repo\/\.git\/refs\/heads\/x\.lock reached the host, outside the agent's tree: /),
    ])
    expect(controlWrites([{ path: '/w/repo/escape.txt', changedOnHost: false }], '/w/repo/.git')).toEqual([])
  })
})
