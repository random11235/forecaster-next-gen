import { describe, expect, test } from 'vitest'
import { smokeVerdict, type SmokeFacts } from '../../scripts/smokeVerdict.ts'

const SKILL_WORD = 'periwinkle'

/** What a passing run shows: the skill's word, no token in its tools' env, and no write that reached the host. */
function facts(overrides: Partial<SmokeFacts> = {}): SmokeFacts {
  return {
    report: JSON.stringify({ skillWord: SKILL_WORD, envNames: ['CLAUDECODE', 'HOME', 'PATH', 'TMPDIR'] }),
    skillWord: SKILL_WORD,
    gitDir: '/w/repo/.git',
    targets: [
      { path: '/w/repo/escape.txt', landed: false },
      { path: '/usr/local/escape.txt', landed: false },
    ],
    ...overrides,
  }
}

const failures = (f: SmokeFacts) => smokeVerdict(f).filter((check) => !check.ok)

describe('the smoke test verdict', () => {
  test('passes a run whose skill expanded, whose env held no token, and whose writes stayed in', () => {
    const checks = smokeVerdict(facts())

    expect(checks.every((check) => check.ok)).toBe(true)
    expect(checks.map((check) => check.says)).toEqual([
      'the skill expanded and ran: the agent reported its word, periwinkle',
      "CLAUDE_CODE_OAUTH_TOKEN reached Claude Code, which signed in to report, and stayed out of its tools' env",
      'no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the agent env',
      'the write to /w/repo/escape.txt never reached the host',
      'the write to /usr/local/escape.txt never reached the host',
    ])
  })

  test("fails a run whose agent didn't report the skill's word, saying what it reported", () => {
    expect(failures(facts({ report: JSON.stringify({ skillWord: 'none', envNames: ['CLAUDE_CODE_OAUTH_TOKEN'] }) }))).toEqual([
      { ok: false, says: "the skill didn't expand: the agent reported none, not periwinkle" },
    ])
  })

  test('fails a run whose agent saw a GitHub token, naming each', () => {
    const report = JSON.stringify({ skillWord: SKILL_WORD, envNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'FACTORY_TOKEN', 'GH_TOKEN'] })

    expect(failures(facts({ report }))).toEqual([{ ok: false, says: 'the agent env held FACTORY_TOKEN, GH_TOKEN' }])
  })

  test("says when Claude Code's tools see the OAuth token too, which the open network lets them leak (R3)", () => {
    const report = JSON.stringify({ skillWord: SKILL_WORD, envNames: ['CLAUDE_CODE_OAUTH_TOKEN', 'PATH'] })

    expect(smokeVerdict(facts({ report }))[1]).toEqual({
      ok: true,
      says: "CLAUDE_CODE_OAUTH_TOKEN reached Claude Code, which signed in to report, and its tools' env holds it too",
    })
  })

  test('fails a run whose write outside the working tree reached the host', () => {
    const targets = [{ path: '/w/repo/escape.txt', landed: true }]

    expect(failures(facts({ targets }))).toEqual([{ ok: false, says: 'the write to /w/repo/escape.txt reached the host' }])
  })

  test('lets a write land in the git dir, which the sandbox mounts writable so the agent can commit, and says so', () => {
    const checks = smokeVerdict(facts({ targets: [{ path: '/w/repo/.git/escape.txt', landed: true }] }))

    expect(checks.at(-1)).toEqual({
      ok: true,
      says: 'the write to /w/repo/.git/escape.txt reached the host: the git dir is writable so the agent can commit',
    })
  })

  test("fails a run whose agent gave no report, or one that isn't the report's shape", () => {
    for (const report of [undefined, 'not json', JSON.stringify({ skillWord: SKILL_WORD })]) {
      expect(failures(facts({ report }))[0]).toEqual({ ok: false, says: `the agent gave no report: ${String(report)}` })
    }
  })
})
