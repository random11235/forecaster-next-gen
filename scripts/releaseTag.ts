// The tag a merge to main is released as (the `release` job in .github/workflows/ci.yml): `v` and the app's version,
// `version` in package.json, which every screen's footer shows, so an EM names the release by what their app says.
// `node scripts/releaseTag.ts` prints `tag=v…` and `new=true` or `new=false` for $GITHUB_OUTPUT, reading the repo's tags,
// and fails, saying why, on a version it can't release.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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
 * The release for a merge to main whose `package.json` sets `version`, given the repo's tags: new when no tag has
 * that version, nothing when one does (a docs-only merge doesn't bump it). A version below the last release is
 * refused, as is one that isn't major.minor.patch.
 */
export function releaseTag(version: string, tags: readonly string[]): Release {
  const semver = parse(version)
  if (!semver) throw new Error(`package.json's version ${version} isn't major.minor.patch, such as 0.3.0.`)
  const tag = `v${version}`
  if (tags.includes(tag)) return { kind: 'released', tag }
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
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { version }: { version: string } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const tags = execFileSync('git', ['tag', '--list'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  const release = releaseTag(version, tags)
  console.log(`tag=${release.tag}\nnew=${release.kind === 'new'}`)
}
