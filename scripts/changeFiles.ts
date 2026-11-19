// Change files, and what a branch leaves to the release: a branch that changes the app says how big its change is in
// `changes/<ticket>.md`, and the release (scripts/release.ts) sets the version and writes CHANGELOG.md from them, as
// docs/design/architecture.md#release sets out. This module holds both sides of that contract: the change file's form
// and what the check refuses on a branch (`node scripts/checkChanges.ts <base>`, which `check:static` runs), and the
// version's places and CHANGELOG.md's layout, its sections and where they go, which the release writes.
import { MIGRATIONS_FILE, migrationSteps } from './migrationSteps.ts'

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
  const changeFiles = changed.flatMap((path) => {
    const text = CHANGE_FILE.test(path) ? read(path, 'head') : undefined
    return text === undefined ? [] : [{ path, text, added: read(path, 'base') === undefined }]
  })
  const problems: string[] = []
  const bumped: { path: string; bump: Bump }[] = []
  for (const { path, text, added } of changeFiles) {
    const change = readChangeFile(path, text)
    if ('problem' in change) problems.push(change.problem)
    else if (added) bumped.push({ path, bump: change.bump })
  }
  const needs = neededBumps(changed, read)
  const needed = biggestBump(needs.map(({ bump }) => bump))
  if (needed !== undefined && !changeFiles.some(({ added }) => added))
    problems.push(
      `This branch ${needs.map(({ why }) => why).join(' and ')} but adds no change file: add changes/<ticket>.md, with ${atLeast(needed)} in its front matter and the changelog line as its body, ${HOW}.`,
    )
  const most = biggestBump(bumped.map(({ bump }) => bump))
  if (most !== undefined)
    for (const { why, bump } of needs)
      if (BUMPS.indexOf(bump) > BUMPS.indexOf(most))
        problems.push(
          `This branch ${why}, so needs ${atLeast(bump)}, but its change files bump \`${most}\` at most (${bumped.map(({ path }) => path).join(', ')}): raise it, ${HOW}.`,
        )
  for (const path of VERSIONED.filter((each) => changed.includes(each))) {
    const [base, head] = [versionsIn(read(path, 'base')), versionsIn(read(path, 'head'))]
    const set = base.findIndex((version, at) => version !== head[at])
    if (set !== -1)
      problems.push(`This branch sets ${path}'s version (${base[set]} to ${head[set]}): leave it, as the release sets it from the change files, ${HOW}.`)
  }
  if (changed.includes('CHANGELOG.md') && split(read('CHANGELOG.md', 'base') ?? '').entries !== split(read('CHANGELOG.md', 'head') ?? '').entries)
    problems.push(`This branch edits the entries in CHANGELOG.md: leave them, as the release writes each from its change file, ${HOW}.`)
  return problems
}

/** `bump` or any bigger, as a change file's front matter would set it. */
function atLeast(bump: Bump): string {
  return BUMPS.slice(BUMPS.indexOf(bump))
    .map((each, i) => (i === 0 ? `\`bump: ${each}\`` : `\`${each}\``))
    .join(', ')
    .replace(/, ([^,]*)$/, ' or $1')
}

/**
 * What the files a branch changes make it need, each with the smallest bump that covers it and why, as
 * docs/agents/pull-requests.md#version sets out: an app file changed needs a patch, a migration step added a major
 * (a one-way door), and a demo screenshot added a minor (a visible change ships one, as docs/agents/demos.md says).
 */
function neededBumps(changed: readonly string[], read: ReadAt): { bump: Bump; why: string }[] {
  const needs: { bump: Bump; why: string }[] = []
  const app = changed.filter((path) => APP_FILES.test(path))
  if (app.length > 0) needs.push({ bump: 'patch', why: `changes the app (${app.join(', ')})` })
  if (changed.includes(MIGRATIONS_FILE)) {
    const steps = (at: 'base' | 'head') => {
      const source = read(MIGRATIONS_FILE, at)
      try {
        return source === undefined ? 0 : migrationSteps(source, at).length
      } catch {
        return 0 // the migration check (checkMigrations.ts) fails a branch whose steps it can't read
      }
    }
    const [base, head] = [steps('base'), steps('head')]
    if (head > base) needs.push({ bump: 'major', why: head === base + 1 ? `adds migration step ${head}` : `adds migration steps ${base + 1}–${head}` })
  }
  const demos = changed.filter((path) => DEMO.test(path) && read(path, 'base') === undefined && read(path, 'head') !== undefined)
  if (demos.length > 0) needs.push({ bump: 'minor', why: `adds demo screenshots (${demos.join(', ')})` })
  return needs
}

/** A demo screenshot, which a visible change ships (docs/agents/demos.md). */
const DEMO = /^docs\/demos\/[^/]+\.png$/

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

/** A release's section in CHANGELOG.md: its version, dated `date`, and a bullet for each of `lines`. */
export function changelogSection(version: string, date: string, lines: readonly string[]): string {
  return `## ${version} (${date})\n\n${lines.map((line) => `- ${line}\n`).join('')}`
}

/** CHANGELOG.md, its text `changelog`, with a release's `section` above the newest release's, below the header. */
export function addSection(changelog: string, section: string): string {
  const { header, entries } = split(changelog)
  return entries === '' ? `${header}\n${section}` : `${header}${section}\n${entries}`
}
