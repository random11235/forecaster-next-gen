// What the factory's smoke test (scripts/factorySmoke.ts, #335) found: from Claude Code's stream-json, from the report the
// agent gave from inside the sandbox, and from what reached the host. Each check passes, fails, or notes what it saw.

/** One check: whether it passed or failed, or only a note of what the run showed; and what it found. */
export type Check = { status: 'pass' | 'fail' | 'note'; says: string }

export type SmokeFacts = {
  /** The agent's output, which ends in its `<smoke-report>` tag if it gave one. */
  stdout: string
  /** Claude Code's stream-json, a line each. */
  stream: string[]
  /** The word only the smoke skill's body holds, which the skill has the agent say first, before any tool. */
  skillWord: string
  /** The repo's git dir, which the sandbox mounts writable so the agent can commit. */
  gitDir: string
  /** Each path outside the agent's working tree it tried to write, and whether a file is there on the host after. */
  targets: { path: string; reached: boolean }[]
  /** How many commits the agent made, which should be none. */
  commits: number
  /** Whether `.sandcastle/.env` exists, whose keys Sandcastle would pass into the sandbox. */
  sandcastleEnvFile: boolean
}

/** The variables that carry a GitHub token, none of which may reach the agent. */
const GITHUB_TOKENS = ['FACTORY_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN']
const OAUTH_TOKEN = 'CLAUDE_CODE_OAUTH_TOKEN'
/** The parts of the git dir git runs or reads as config, which the sandbox should keep read-only. */
const GIT_CONTROL = ['hooks', 'config', 'info']
const REPORT = /<smoke-report>([\s\S]*?)<\/smoke-report>/

const pass = (says: string): Check => ({ status: 'pass', says })
const fail = (says: string): Check => ({ status: 'fail', says })
const note = (says: string): Check => ({ status: 'note', says })

const cut = (text: string, length = 200): string => (text.length > length ? `${text.slice(0, length)}…` : text)

/** What the agent saw from inside: the names in its tools' env, and in Claude Code's, or why that couldn't be read. */
type Report = { envNames: string[]; claudeEnvNames: string[] | string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const isNames = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function parseReport(stdout: string): Report | undefined {
  const value = parseJson(REPORT.exec(stdout)?.[1] ?? '')
  if (!isRecord(value)) return undefined
  const { envNames, claudeEnvNames } = value
  if (!isNames(envNames) || !(isNames(claudeEnvNames) || typeof claudeEnvNames === 'string')) return undefined
  return { envNames, claudeEnvNames }
}

/** Each stream-json line's JSON, as records, dropping any that isn't one. */
const events = (stream: string[]): Record<string, unknown>[] => stream.map(parseJson).filter(isRecord)

/** The agent's first text or tool call, past any thinking. */
function firstMove(stream: string[]): Record<string, unknown> | undefined {
  for (const event of events(stream)) {
    if (event.type !== 'assistant' || !isRecord(event.message) || !Array.isArray(event.message.content)) continue
    const move = event.message.content.filter(isRecord).find(({ type }) => type === 'text' || type === 'tool_use')
    if (move) return move
  }
  return undefined
}

// Expanded, the skill's body is the prompt, so the model says its word straight off. Not expanded, the model has only
// the text `/factory-smoke …`, and finds the skill with a tool (its Skill tool, or by reading the file) before it can.
function skillCheck(stream: string[], skillWord: string): Check {
  const move = firstMove(stream)
  const failed = (what: string) => fail(`the slash command didn't expand: the agent's first move was ${what}`)
  if (move === undefined) return failed('nothing')
  if (move.type === 'tool_use') return failed(`${String(move.name)} ${JSON.stringify(move.input)}`)
  const said = String(move.text).trim()
  if (said.startsWith(skillWord)) {
    return pass(`the slash command expanded: the agent's first words, before any tool, were the skill's word, ${skillWord}`)
  }
  return failed(`to say ${JSON.stringify(cut(said, 100))}`)
}

/** The control: the same check on a run that sent the prompt on stdin, as a note, since the model may find the skill. */
export function stdinNote(stream: string[], skillWord: string): Check {
  return note(`on stdin, as Sandcastle sends it, ${skillCheck(stream, skillWord).says}`)
}

function modelNote(stream: string[]): Check {
  const init = events(stream).find(({ type, subtype }) => type === 'system' && subtype === 'init')
  return note(`the model ran as ${String(init?.model ?? 'an unknown model: Claude Code sent no init')}`)
}

function envChecks({ envNames, claudeEnvNames }: Report): Check[] {
  const inTools = GITHUB_TOKENS.filter((name) => envNames.includes(name))
  if (typeof claudeEnvNames === 'string') {
    return [
      note(`Claude Code's own env couldn't be read (${cut(claudeEnvNames, 100)}): only its tools' env was checked`),
      inTools.length === 0
        ? pass("no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the env of Claude Code's tools")
        : fail(`${inTools.join(', ')} reached Claude Code's tools' env`),
      note(`${OAUTH_TOKEN} ${envNames.includes(OAUTH_TOKEN) ? 'reached' : 'stayed out of'} its tools' env`),
    ]
  }
  const inClaude = GITHUB_TOKENS.filter((name) => claudeEnvNames.includes(name))
  const reached = [
    ...(inClaude.length > 0 ? [`${inClaude.join(', ')} reached Claude Code's env`] : []),
    ...(inTools.length > 0 ? [`${inTools.join(', ')} reached its tools' env`] : []),
  ]
  const toolsToo = envNames.includes(OAUTH_TOKEN) ? ", and its tools' env holds it too" : ''
  return [
    reached.length === 0 ? pass('no FACTORY_TOKEN, GITHUB_TOKEN or GH_TOKEN in the env of Claude Code or of its tools') : fail(reached.join('; ')),
    claudeEnvNames.includes(OAUTH_TOKEN)
      ? pass(`${OAUTH_TOKEN} reached Claude Code's env, from which its tools can read it through /proc/$CLAUDE_PID/environ (R3)${toolsToo}`)
      : fail(`${OAUTH_TOKEN} wasn't in Claude Code's env`),
  ]
}

function writeCheck({ path, reached }: SmokeFacts['targets'][number], gitDir: string): Check {
  if (!reached) return pass(`the write to ${path} never reached the host`)
  if (GIT_CONTROL.some((part) => path === `${gitDir}/${part}` || path.startsWith(`${gitDir}/${part}/`))) {
    return fail(`the write to ${path} reached the host, where git runs or reads it (R4)`)
  }
  if (path.startsWith(`${gitDir}/`)) {
    return note(`the write to ${path} reached the host: the git dir is writable, so host steps must not trust its refs`)
  }
  return fail(`the write to ${path} reached the host`)
}

export function smokeVerdict(facts: SmokeFacts): Check[] {
  const report = parseReport(facts.stdout)
  return [
    skillCheck(facts.stream, facts.skillWord),
    modelNote(facts.stream),
    ...(report ? envChecks(report) : [fail(`the agent gave no report: ${cut(facts.stdout.trim())}`)]),
    facts.sandcastleEnvFile
      ? fail('.sandcastle/.env exists: Sandcastle passes the keys it names into the sandbox')
      : pass("no .sandcastle/.env, so the sandbox's env is factoryAgent()'s, plus bwrap's PATH, HOME and TMPDIR"),
    facts.commits === 0 ? pass('the agent made no commit') : fail(`the agent made ${facts.commits} commits, though the skill says to make none`),
    ...facts.targets.map((target) => writeCheck(target, facts.gitDir)),
  ]
}

/** How the capped run ended: with the agent's output, or with Sandcastle's error, which holds Claude Code's stream-json. */
export type CappedRun = { stdout: string } | { error: string }

/** Whether `--max-budget-usd` at `cap` dollars stopped a run, from Claude Code's result: error_max_budget_usd. */
export function budgetVerdict(run: CappedRun, cap: number): Check {
  if ('stdout' in run) return fail(`the $${cap} cap didn't stop the run, which said: ${cut(run.stdout.trim())}`)
  const result = events(run.error.split('\n')).find(({ type }) => type === 'result')
  if (result?.subtype !== 'error_max_budget_usd') return fail(`the capped run failed, not on its budget: ${cut(run.error)}`)
  const turns = Number(result.num_turns)
  return pass(
    `the $${cap} cap stopped the run after ${turns} turn${turns === 1 ? '' : 's'}, at $${String(result.total_cost_usd)}: ` +
      'Claude Code checks it after each turn, so a run overshoots it by up to a turn',
  )
}
