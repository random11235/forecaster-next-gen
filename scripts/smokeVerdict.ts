// What the factory's smoke test (scripts/factorySmoke.ts, #335) found: from the report the agent gave from inside the
// sandbox, and from what reached the host. Each check passes or fails with what it saw, for the job's log.

/** One check: whether it passed, and what it found. */
export type Check = { ok: boolean; says: string }

export type SmokeFacts = {
  /** The JSON inside the agent's `<smoke-report>` tag, if it gave one: `{ skillWord, envNames }`. */
  report: string | undefined
  /** The word only the smoke skill's body holds, so the agent knows it only if the skill expanded. */
  skillWord: string
  /** The repo's git dir, which the sandbox mounts writable so the agent can commit. */
  gitDir: string
  /** Each path outside the working tree the agent tried to write, and whether a file is there on the host after. */
  targets: { path: string; landed: boolean }[]
}

/** The variables that carry a GitHub token, none of which may reach the agent. */
const GITHUB_TOKENS = ['FACTORY_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']
const OAUTH_TOKEN = 'CLAUDE_CODE_OAUTH_TOKEN'

type Report = { skillWord: string; envNames: string[] }

function parsed(report: string | undefined): Report | undefined {
  try {
    const value: unknown = JSON.parse(report ?? '')
    if (typeof value !== 'object' || value === null) return undefined
    const { skillWord, envNames } = value as Record<string, unknown>
    if (typeof skillWord !== 'string' || !Array.isArray(envNames)) return undefined
    return { skillWord, envNames: envNames.map(String) }
  } catch {
    return undefined
  }
}

function writeCheck({ path, landed }: SmokeFacts['targets'][number], gitDir: string): Check {
  if (!landed) return { ok: true, says: `the write to ${path} never reached the host` }
  if (path.startsWith(`${gitDir}/`)) {
    return { ok: true, says: `the write to ${path} reached the host: the git dir is writable so the agent can commit` }
  }
  return { ok: false, says: `the write to ${path} reached the host` }
}

export function smokeVerdict({ report, skillWord, gitDir, targets }: SmokeFacts): Check[] {
  const writes = targets.map((target) => writeCheck(target, gitDir))
  const found = parsed(report)
  if (found === undefined) return [{ ok: false, says: `the agent gave no report: ${String(report)}` }, ...writes]
  const tokens = GITHUB_TOKENS.filter((name) => found.envNames.includes(name))
  return [
    found.skillWord === skillWord
      ? { ok: true, says: `the skill expanded and ran: the agent reported its word, ${skillWord}` }
      : { ok: false, says: `the skill didn't expand: the agent reported ${found.skillWord}, not ${skillWord}` },
    // Claude Code had it, or there would be no report; whether its tools' env holds it too is worth knowing (R3)
    {
      ok: true,
      says: `${OAUTH_TOKEN} reached Claude Code, which signed in to report, and ${found.envNames.includes(OAUTH_TOKEN) ? "its tools' env holds it too" : "stayed out of its tools' env"}`,
    },
    tokens.length === 0
      ? { ok: true, says: 'no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the agent env' }
      : { ok: false, says: `the agent env held ${tokens.join(', ')}` },
    ...writes,
  ]
}
