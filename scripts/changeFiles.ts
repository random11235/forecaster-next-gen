// Change files, and what a branch leaves to the release: a branch that changes the app says how big its change is in
// `changes/<ticket>.md`, and the release (scripts/release.ts) sets the version and writes CHANGELOG.md from them, as
// docs/design/architecture.md#release sets out. This module holds both sides of that contract: the change file's form
// and what the check refuses on a branch (`node scripts/checkChanges.ts <base>`, which `check:static` runs), and the
// version's places and CHANGELOG.md's layout, which the release writes.

/**
 * The files that make the app an EM runs: its source, its dependencies and how it is built. A branch that changes one
 * changes the app, so adds a change file; a merge that changes none (docs, tests, CI) releases nothing. Both tsconfig
 * files count: tsconfig.build.json extends tsconfig.json, whose target, module and strictness the build uses.
 */
export const APP_FILES = /^(src\/|package(-lock)?\.json$|tsconfig(\.build)?\.json$|scripts\/buildWeb\.ts$)/

/**
 * A change file: `changes/<ticket>.md`, its own name in each branch, so no two branches edit the same line. A README
 * there would say what the folder is for, so isn't one.
 */
export const CHANGE_FILE = /^changes\/(?!README\.md$)[^/]+\.md$/

const HOW = 'as docs/agents/pull-requests.md#version says'

/** How big a change is, as docs/agents/pull-requests.md#version sets out: the part of the version a release raises. */
const BUMPS = ['patch', 'minor', 'major'] as const
export type Bump = (typeof BUMPS)[number]

/** The biggest of `bumps`, the part of the version a release of them all raises; none, undefined. */
export function biggestBump(bumps: readonly Bump[]): Bump | undefined {
  return [...BUMPS].reverse().find((each) => bumps.includes(each))
}

/** What a change file says: how big its change is, and its line in CHANGELOG.md. */
type Change = { bump: Bump; line: string }

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

/** The files that hold the app's version, which the release sets. */
export const VERSIONED = ['package.json', 'package-lock.json']

/** A file as a branch's base or head holds it, or undefined where it holds none. */
type ReadAt = (path: string, at: 'base' | 'head') => string | undefined

/**
 * Why a branch, given the files it changes since its base and how to read each, can't be released as it stands: it
 * changes the app but adds no change file (editing one already on its base adds none), a change file it holds can't be
 * read, or it sets the version or edits CHANGELOG.md's entries, which the release writes. None, it can.
 */
export function changeFileProblems(changed: readonly string[], read: ReadAt): string[] {
  const app = changed.filter((path) => APP_FILES.test(path))
  const changeFiles = changed.flatMap((path) => {
    const text = CHANGE_FILE.test(path) ? read(path, 'head') : undefined
    return text === undefined ? [] : [{ path, text, added: read(path, 'base') === undefined }]
  })
  const problems = changeFiles.flatMap(({ path, text }) => {
    const change = readChangeFile(path, text)
    return 'problem' in change ? [change.problem] : []
  })
  if (app.length > 0 && !changeFiles.some(({ added }) => added))
    problems.push(
      `This branch changes the app (${app.join(', ')}) but adds no change file: add changes/<ticket>.md, with \`bump: patch\`, \`minor\` or \`major\` in its front matter and the changelog line as its body, ${HOW}.`,
    )
  for (const path of VERSIONED.filter((each) => changed.includes(each))) {
    const [base, head] = [versionsIn(read(path, 'base')), versionsIn(read(path, 'head'))]
    const set = base.findIndex((version, at) => version !== head[at])
    if (set !== -1)
      problems.push(`This branch sets ${path}'s version (${base[set]} to ${head[set]}): leave it, as the release sets it from the change files, ${HOW}.`)
  }
  if (changed.includes('CHANGELOG.md') && entriesIn(read('CHANGELOG.md', 'base')) !== entriesIn(read('CHANGELOG.md', 'head')))
    problems.push(`This branch edits the entries in CHANGELOG.md: leave them, as the release writes each from its change file, ${HOW}.`)
  return problems
}

/** package.json, or package-lock.json, whose own package's entry in `packages` holds the version too. */
type Package = { version?: unknown; packages?: Record<string, { version?: unknown }> }

/** Each place a file of `VERSIONED` holds the version: its `version`, and its own package's in package-lock.json. */
function versionsIn(json: string | undefined): unknown[] {
  if (json === undefined) return [undefined, undefined]
  const { version, packages } = JSON.parse(json) as Package
  return [version, packages?.['']?.version]
}

/** A file of `VERSIONED`, its text `json`, with `version` in each place it holds the version. */
export function withVersion(json: string, version: string): string {
  const parsed = JSON.parse(json) as Package
  parsed.version = version
  const own = parsed.packages?.['']
  if (own) own.version = version
  return `${JSON.stringify(parsed, null, 2)}\n`
}

/** CHANGELOG.md's header, a branch's to edit, and its entries, each release's section, newest first. */
function split(changelog: string): { header: string; entries: string } {
  const first = changelog.search(/^## /m)
  return first === -1 ? { header: changelog, entries: '' } : { header: changelog.slice(0, first), entries: changelog.slice(first) }
}

function entriesIn(changelog = ''): string {
  return split(changelog).entries
}

/** CHANGELOG.md, its text `changelog`, with a release's `section` above the newest release's, below the header. */
export function addSection(changelog: string, section: string): string {
  const { header, entries } = split(changelog)
  return entries === '' ? `${header}\n${section}` : `${header}${section}\n${entries}`
}
