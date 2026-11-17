// Change files: how a branch that changes the app says how big its change is, so the release, not the branch, sets the
// version (scripts/releaseTag.ts). `node scripts/checkChanges.ts <base>`, which `check:static` runs, checks a branch
// with `changeFileProblems`.

/**
 * The files that make the app an EM runs: its source, its dependencies and how it is built. A branch that changes one
 * changes the app, so adds a change file; a merge that changes none (docs, tests, CI) releases nothing. Both tsconfig
 * files count: tsconfig.build.json extends tsconfig.json, whose target, module and strictness the build uses.
 */
const APP_FILES = /^(src\/|package(-lock)?\.json$|tsconfig(\.build)?\.json$|scripts\/buildWeb\.ts$)/

/** A change file: `changes/<ticket>.md`, its own name in each branch, so no two branches edit the same line. */
export const CHANGE_FILE = /^changes\/[^/]+\.md$/

const HOW = 'as docs/agents/pull-requests.md#version says'

/** How big a change is, as docs/agents/pull-requests.md#version sets out: what part of the version the release raises. */
export type Bump = 'patch' | 'minor' | 'major'

const BUMPS: readonly Bump[] = ['patch', 'minor', 'major']

/** What a change file says: how big its change is, and its line in CHANGELOG.md. */
export type Change = { bump: Bump; line: string }

/**
 * A change file's front matter, between `---` lines, sets `bump` (any other key is ignored); its body is the changelog
 * line. Either missing or wrong gives the problem, naming the file at `path`.
 */
export function readChangeFile(path: string, text: string): Change | { problem: string } {
  const [, frontMatter = '', body = ''] = /^---\n([\s\S]*?\n)?---(?:\n([\s\S]*))?$/.exec(text.replaceAll('\r\n', '\n')) ?? []
  const bump = BUMPS.find((each) => new RegExp(`^bump: ${each}$`, 'm').test(frontMatter))
  if (!bump) return { problem: `${path} has no valid bump: start it with front matter setting \`bump: patch\`, \`minor\` or \`major\`, ${HOW}.` }
  const [line, ...more] = body.split('\n').filter((each) => each.trim() !== '')
  if (line === undefined || more.length > 0) return { problem: `${path}'s body isn't one line: write the changelog line as its body, ${HOW}.` }
  return { bump, line: line.trim() }
}

/** A file as a branch's base or head holds it, or undefined where it holds none. */
export type ReadAt = (path: string, at: 'base' | 'head') => string | undefined

/**
 * Why a branch, given the files it changes since its base and how to read each, can't be released as it stands: it
 * changes the app but adds no change file, or a change file it adds can't be read. None, it can.
 */
export function changeFileProblems(changed: readonly string[], read: ReadAt): string[] {
  const app = changed.filter((path) => APP_FILES.test(path))
  const changeFiles = changed.flatMap((path) => {
    const text = CHANGE_FILE.test(path) ? read(path, 'head') : undefined
    return text === undefined ? [] : [{ path, text }]
  })
  const problems = changeFiles.flatMap(({ path, text }) => {
    const change = readChangeFile(path, text)
    return 'problem' in change ? [change.problem] : []
  })
  if (app.length > 0 && changeFiles.length === 0)
    problems.push(
      `This branch changes the app (${app.join(', ')}) but adds no change file: add changes/<ticket>.md, with \`bump: patch\`, \`minor\` or \`major\` in its front matter and the changelog line as its body, ${HOW}.`,
    )
  for (const path of ['package.json', 'package-lock.json'].filter((each) => changed.includes(each))) {
    const [base, head] = [versionIn(read(path, 'base')), versionIn(read(path, 'head'))]
    if (base !== head) problems.push(`This branch sets ${path}'s version (${base} to ${head}): leave it, as the release sets it from the change files, ${HOW}.`)
  }
  if (changed.includes('CHANGELOG.md') && entriesIn(read('CHANGELOG.md', 'base')) !== entriesIn(read('CHANGELOG.md', 'head')))
    problems.push(`This branch edits the entries in CHANGELOG.md: leave them, as the release writes each from its change file, ${HOW}.`)
  return problems
}

/** `version` in package.json or package-lock.json. */
function versionIn(json: string | undefined): unknown {
  return json === undefined ? undefined : (JSON.parse(json) as { version?: unknown }).version
}

/** CHANGELOG.md's entries: each version's section, from the first `## ` heading on, below the header. */
function entriesIn(changelog = ''): string {
  const first = changelog.search(/^## /m)
  return first === -1 ? '' : changelog.slice(first)
}
