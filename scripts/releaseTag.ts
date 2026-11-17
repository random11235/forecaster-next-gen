// The release a merge to main makes (the `release` job in .github/workflows/ci.yml), from the change files on main's
// tip (scripts/changeFiles.ts): each says how big its change is, and the release raises the last release's version by
// the biggest. It is tagged `v` and that version, `version` in package.json (semver), which every screen's footer
// shows, so an EM names the release by what their app says. A PR says how big its change is; the release, one at a
// time, picks the number, so no two PRs edit the same line.
// `node scripts/releaseTag.ts`, at the root of a checkout of main's tip, with no change file there (a docs-only merge,
// or one an earlier release took in), prints `new=false` and changes nothing. Otherwise it sets `version` in
// package.json and package-lock.json, adds the release's section to the top of CHANGELOG.md, deletes the change files,
// commits that to the branch checked out and tags the commit, printing `tag=v…` and `new=true` for $GITHUB_OUTPUT: the
// job pushes both. A change file it can't read (only a push straight to main skips the check) fails it, saying why.

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { CHANGE_FILE, readChangeFile, type Bump } from './changeFiles.ts'

/** A change file on main's tip, with the pull request whose merge brought it in, if one did. */
export type Merged = { path: string; text: string; pr: number | undefined }

/** The release main's change files make: its version, its tag, and its section at the top of CHANGELOG.md. */
export type Release = { version: string; tag: string; section: string }

type Semver = [major: number, minor: number, patch: number]

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function parse(version: string): Semver | undefined {
  const match = SEMVER.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

function compare(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

function raise([major, minor, patch]: Semver, bump: Bump): Semver {
  if (bump === 'major') return [major + 1, 0, 0]
  if (bump === 'minor') return [major, minor + 1, 0]
  return [major, minor, patch + 1]
}

/**
 * The release that `merged`, the change files on main's tip in the order their merges brought them, make: the last
 * release, the highest `v` and major.minor.patch of `tags` (with none, package.json's `version`), raised by the biggest
 * bump among them, its section dated `date`. No change files, no release.
 */
export function nextRelease(version: string, tags: readonly string[], merged: readonly Merged[], date: string): Release | undefined {
  const changes = merged.map(({ path, text, pr }) => {
    const change = readChangeFile(path, text)
    if ('problem' in change) throw new Error(change.problem)
    return { ...change, pr }
  })
  const last = tags
    .flatMap((tag) => {
      const released = tag.startsWith('v') ? parse(tag.slice(1)) : undefined
      return released ? [released] : []
    })
    .sort((a, b) => compare(b, a))[0]
  const bump = (['major', 'minor', 'patch'] as const).find((each) => changes.some((change) => change.bump === each))
  if (!bump) return undefined
  const from = last ?? parse(version)
  if (!from) throw new Error(`package.json's version ${version} isn't major.minor.patch, such as 0.3.0.`)
  const next = raise(from, bump).join('.')
  const lines = changes.map(({ line, pr }) => `- ${withPr(line, pr)}\n`)
  return { version: next, tag: `v${next}`, section: `## ${next} (${date})\n\n${lines.join('')}` }
}

/** A change file's line with the PR that merged it: in its closing `(#…)`, the tickets it names, or after it. */
function withPr(line: string, pr: number | undefined): string {
  if (pr === undefined) return line
  const tickets = /\(([^()]*#\d+)\)$/.exec(line)
  return tickets ? `${line.slice(0, tickets.index)}(${tickets[1]}, PR #${pr})` : `${line} (PR #${pr})`
}

/**
 * The change files in the checkout of main's tip, each with its pull request: the newest commit on main itself (its
 * first parents) to add it, a merge read from its `Merge pull request #N`, so an integration branch's tickets carry the
 * PR that merged it into main. In the order those commits came, one commit's in ticket order.
 */
function mergedChangeFiles(git: (...args: string[]) => string): Merged[] {
  // newest first: each commit's subject, then the change files it added, a merge's against main before it
  const adds = git('log', '--first-parent', '--diff-merges=first-parent', '--diff-filter=A', '--name-only', '--format=%x00%s', '--', 'changes')
    .split('\0')
    .slice(1)
    .map((commit) => commit.split('\n').filter(Boolean))
  return git('ls-files', '--', 'changes')
    .split('\n')
    .filter((path) => CHANGE_FILE.test(path))
    .map((path) => {
      const at = adds.findIndex(([, ...added]) => added.includes(path))
      const [subject = ''] = adds[at] ?? []
      const pr = /^Merge pull request #(\d+)/.exec(subject)?.[1]
      return { path, text: readFileSync(path, 'utf8'), pr: pr === undefined ? undefined : Number(pr), at }
    })
    .sort((a, b) => b.at - a.at || a.path.localeCompare(b.path, 'en', { numeric: true }))
    .map(({ path, text, pr }) => ({ path, text, pr }))
}

/** package.json, or package-lock.json, whose own package's entry in `packages` holds the version too. */
type Package = { version?: string; packages?: Record<string, { version?: string }> }

if (import.meta.main) {
  // the checkout it runs from, its root, as the release job runs it: main's tip
  const git = (...args: string[]): string => execFileSync('git', args, { encoding: 'utf8' })
  const merged = mergedChangeFiles(git)
  const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }
  // the day main's tip was made, in UTC: the day the last change in the release merged
  const date = new Date(git('log', '-1', '--format=%cI').trim()).toISOString().slice(0, 10)
  const release = nextRelease(version, git('tag', '--list').split('\n').filter(Boolean), merged, date)
  if (!release) {
    console.log('new=false')
  } else {
    for (const path of ['package.json', 'package-lock.json']) {
      const json = JSON.parse(readFileSync(path, 'utf8')) as Package
      json.version = release.version
      const own = json.packages?.['']
      if (own) own.version = release.version
      writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`)
    }
    const changelog = readFileSync('CHANGELOG.md', 'utf8')
    const first = changelog.search(/^## /m)
    writeFileSync(
      'CHANGELOG.md',
      first === -1 ? `${changelog}\n${release.section}` : `${changelog.slice(0, first)}${release.section}\n${changelog.slice(first)}`,
    )
    git('rm', '-q', '--', ...merged.map(({ path }) => path))
    git('add', '--', 'package.json', 'package-lock.json', 'CHANGELOG.md')
    git('commit', '-q', '-m', `Version ${release.version}`, '-m', release.section)
    git('tag', release.tag)
    console.log(`tag=${release.tag}\nnew=true`)
  }
}
