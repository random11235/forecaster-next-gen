// The release each merge to main makes. The `release` job in .github/workflows/ci.yml runs
// `node scripts/release.ts "$GITHUB_SHA"` at the root of a checkout of main's tip: it commits the version and the
// CHANGELOG.md section the change files make (scripts/changeFiles.ts) onto the tip, tags it and pushes both, then
// prints, for $GITHUB_OUTPUT, the last release's tag (`tag=v…`) and whether it made one now (`new=true`). Which change
// files it takes, and what it does when main moves on, docs/design/architecture.md#release sets out.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { addSection, biggestBump, CHANGE_FILE, changelogSection, readChangeFile, VERSIONED, withVersion, type Bump } from './changeFiles.ts'

type Git = (...args: string[]) => string

/** A change file on main's tip, with the pull request whose merge brought it onto main, if one did. */
type MergedChangeFile = { path: string; text: string; pr: number | undefined }

/** A release: its version, its tag, and its section at the top of CHANGELOG.md. */
type Release = { version: string; tag: string; section: string }

type Semver = [major: number, minor: number, patch: number]

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function parse(version: string): Semver | undefined {
  const match = SEMVER.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

/** The releases among `tags`, each `v` and its major.minor.patch, highest first. */
function releasesIn(tags: readonly string[]): { tag: string; version: Semver }[] {
  return tags
    .flatMap((tag) => {
      const version = tag.startsWith('v') ? parse(tag.slice(1)) : undefined
      return version ? [{ tag, version }] : []
    })
    .sort(({ version: a }, { version: b }) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])
}

function raise([major, minor, patch]: Semver, bump: Bump): Semver {
  if (bump === 'major') return [major + 1, 0, 0]
  if (bump === 'minor') return [major, minor + 1, 0]
  return [major, minor, patch + 1]
}

/**
 * The release that `merged`, change files in the order their merges brought them, make: the last release, the highest
 * of `tags` (with none, package.json's `version`), raised by the biggest bump among them, its section dated `date`. No
 * change files, no release.
 */
export function nextRelease({ version, tags, merged, date }: { version: string; tags: readonly string[]; merged: readonly MergedChangeFile[]; date: string }) {
  const changes = merged.map(({ path, text, pr }) => {
    const change = readChangeFile(path, text)
    if ('problem' in change) throw new Error(change.problem)
    return { ...change, pr }
  })
  const bump = biggestBump(changes.map((change) => change.bump))
  if (!bump) return undefined
  const from = releasesIn(tags)[0]?.version ?? parse(version)
  if (!from) throw new Error(`package.json's version ${version} isn't major.minor.patch, such as 0.3.0.`)
  const next = raise(from, bump).join('.')
  const section = changelogSection(
    next,
    date,
    changes.map(({ line, pr }) => withPr(line, pr)),
  )
  return { version: next, tag: `v${next}`, section } satisfies Release
}

/** A change file's line with the PR that merged it: in its closing `(#…)`, the tickets it names, or after it. */
function withPr(line: string, pr: number | undefined): string {
  if (pr === undefined) return line
  const tickets = /\(([^()]*#\d+)\)$/.exec(line)
  return tickets ? `${line.slice(0, tickets.index)}(${tickets[1]}, PR #${pr})` : `${line} (PR #${pr})`
}

/**
 * The change files a release takes from main's tip (HEAD): those `checked`, the commit its CI run checked, holds as
 * they are, so one a later merge adds, re-adds or edits is left to that merge's own run. Each with its pull request:
 * the newest commit on main itself (its first parents) to add it, a merge read from its `Merge pull request #N`, so an
 * integration branch's tickets carry the PR that merged it into main; one pushed straight to main has none. In the
 * order those commits came, one commit's in ticket order. One no commit adds, as can't happen but in a shallow clone,
 * has no PR and comes first, as older than any.
 */
export function mergedChangeFiles(git: Git, checked: string): MergedChangeFile[] {
  /** Each change file `commit` holds, by path, its content's blob. */
  const changeFilesAt = (commit: string) =>
    new Map(
      git('ls-tree', '-r', '-z', commit, '--', 'changes')
        .split('\0')
        .flatMap((entry) => {
          const [, blob = '', path = ''] = /^\S+ \S+ (\S+)\t(.*)$/.exec(entry) ?? []
          return CHANGE_FILE.test(path) ? [[path, blob] as const] : []
        }),
    )
  const asChecked = changeFilesAt(checked)
  // main's own commits, newest first: each one's subject, then the change files it added, a merge's against main before
  // it; a rename as a deletion and an addition, so a merge that renames one adds it
  const commits = git(
    'log',
    '--first-parent',
    '--diff-merges=first-parent',
    '--no-renames',
    '--diff-filter=A',
    '--name-only',
    '--format=%x00%s',
    'HEAD',
    '--',
    'changes',
  )
    .split('\0')
    .slice(1)
    .map((commit) => {
      const [subject = '', ...added] = commit.split('\n').filter(Boolean)
      return { subject, added }
    })
  return [...changeFilesAt('HEAD')]
    .filter(([path, blob]) => asChecked.get(path) === blob)
    .map(([path]) => {
      const found = commits.findIndex(({ added }) => added.includes(path))
      const at = found === -1 ? commits.length : found
      const pr = /^Merge pull request #(\d+)/.exec(commits[at]?.subject ?? '')?.[1]
      return { path, text: git('show', `HEAD:${path}`), pr: pr === undefined ? undefined : Number(pr), at }
    })
    .sort((a, b) => b.at - a.at || a.path.localeCompare(b.path, 'en', { numeric: true }))
    .map(({ path, text, pr }) => ({ path, text, pr }))
}

const tagsIn = (git: Git): string[] => git('tag', '--list').split('\n')

/** Commits and tags, onto the branch checked out, the release `checked`'s change files make there; none, undefined. */
function commitRelease(git: Git, checked: string): Release | undefined {
  const merged = mergedChangeFiles(git, checked)
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
  // the day `checked` was made, in UTC: the day the last change in the release merged
  const date = new Date(git('log', '-1', '--format=%cI', checked).trim()).toISOString().slice(0, 10)
  const release = nextRelease({ version, tags: tagsIn(git), merged, date })
  if (!release) return undefined
  for (const path of VERSIONED) writeFileSync(path, withVersion(readFileSync(path, 'utf8'), release.version))
  writeFileSync('CHANGELOG.md', addSection(readFileSync('CHANGELOG.md', 'utf8'), release.section))
  git('rm', '-q', '--', ...merged.map(({ path }) => path))
  git('add', '--', ...VERSIONED, 'CHANGELOG.md')
  git('commit', '-q', '-m', `Version ${release.version}`, '-m', release.section)
  git('tag', release.tag)
  return release
}

/** How many times the release is made and pushed before it gives up: main moving on more often is far from usual. */
const TRIES = 3

/** Makes the release `checked`'s change files make, and pushes it, its commit and tag together, to main on origin. */
function pushRelease(git: Git, checked: string): Release | undefined {
  for (let tried = 1; ; tried++) {
    const release = commitRelease(git, checked)
    if (!release) return undefined
    try {
      git('push', '--quiet', '--atomic', 'origin', 'HEAD:main', `refs/tags/${release.tag}`)
      return release
    } catch {
      // git has said why; most likely main moved on since the checkout: make the release again on its tip now
      git('tag', '--delete', release.tag)
      if (tried === TRIES) throw new Error(`Couldn't push ${release.tag} to main after ${TRIES} tries: re-run the release job.`)
      git('fetch', '--quiet', '--tags', 'origin', '+refs/heads/main:refs/remotes/origin/main')
      git('reset', '--quiet', '--hard', 'origin/main')
    }
  }
}

if (import.meta.main) {
  // the checkout it runs from, its root, as the release job runs it
  const git: Git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
  const [checked] = process.argv.slice(2)
  try {
    if (checked === undefined) throw new Error('Name the commit CI checked: node scripts/release.ts "$GITHUB_SHA".')
    const release = pushRelease(git, checked)
    const [last] = releasesIn(tagsIn(git))
    console.log(`${last ? `tag=${last.tag}\n` : ''}new=${release !== undefined}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
