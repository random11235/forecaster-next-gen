// The tag a merge to main is released as (the `release` job in .github/workflows/ci.yml): `v` and the app's version,
// `version` in package.json (semver), which every screen's footer shows, so an EM names the release by what their app
// says. `node scripts/releaseTag.ts` prints `tag=v…` and `new=true` or `new=false` for $GITHUB_OUTPUT, reading the
// tags and what changed since the version's tag in the checkout it runs from, and fails, saying why, on a version it
// can't release.
import { execFileSync } from 'node:child_process'
import { APP_VERSION } from '../src/forecast/appVersion.ts'

/** What a merge to main releases: a new release tagged `tag`, or nothing, its version `tag` already released. */
export type Release = { kind: 'new' | 'released'; tag: string }

type Semver = [major: number, minor: number, patch: number]

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/

function parse(version: string): Semver | undefined {
  const match = SEMVER.exec(version)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

function compare(a: Semver, b: Semver): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

/**
 * The files that make the app an EM runs: its source, its dependencies and how it is built. A merge that changes one
 * changes the app, so must bump the version; a merge that changes none (docs, tests, CI, the typecheck's
 * tsconfig.json) releases nothing.
 */
const APP_FILES = /^(src\/|package(-lock)?\.json$|tsconfig\.build\.json$|scripts\/buildWeb\.ts$)/

/**
 * The release for a merge to main whose `package.json` sets `version`, given the repo's tags and the files changed
 * since a tag: new when no tag has that version, nothing when one does and no app file has changed since (a docs-only
 * merge doesn't bump it). An app change that doesn't bump the version is refused, so a release is never skipped
 * silently, as are a version below the last release and one that isn't major.minor.patch.
 */
export function releaseTag(version: string, tags: readonly string[], changedSince: (tag: string) => readonly string[]): Release {
  const semver = parse(version)
  if (!semver) throw new Error(`package.json's version ${version} isn't major.minor.patch, such as 0.3.0.`)
  const tag = `v${version}`
  if (tags.includes(tag)) {
    const changed = changedSince(tag).filter((file) => APP_FILES.test(file))
    if (changed.length > 0)
      throw new Error(
        `package.json's version ${version} is released already, as ${tag}, but the app has changed since (${changed.join(', ')}): set a higher one, as docs/agents/pull-requests.md says.`,
      )
    return { kind: 'released', tag }
  }
  const last = tags
    .flatMap((each) => {
      const released = each.startsWith('v') ? parse(each.slice(1)) : undefined
      return released ? [{ tag: each, released }] : []
    })
    .sort((a, b) => compare(b.released, a.released))[0]
  if (last && compare(semver, last.released) < 0)
    throw new Error(`package.json's version ${version} is below the last release, ${last.tag}: set a higher one, as docs/agents/pull-requests.md says.`)
  return { kind: 'new', tag }
}

if (import.meta.main) {
  // the checkout it runs from, its root as the release job runs it
  const git = (...args: string[]): string[] => execFileSync('git', args, { encoding: 'utf8' }).split('\n').filter(Boolean)
  const release = releaseTag(APP_VERSION, git('tag', '--list'), (tag) => git('diff', '--name-only', tag, 'HEAD'))
  console.log(`tag=${release.tag}\nnew=${release.kind === 'new'}`)
}
