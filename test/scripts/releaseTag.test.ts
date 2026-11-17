import { describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { releaseTag } from '../../scripts/releaseTag.ts'
import { APP_VERSION } from '../../src/forecast/appVersion.js'

/** No file changed since a tag: a merge that changes only what the given files are. */
const NOTHING = (): readonly string[] => []

// The release job (.github/workflows/ci.yml) tags each merge to main with the app's version, `version` in
// package.json, which every screen's footer shows, so the EM names the release by what the app says.
describe('the release tag for a merge to main', () => {
  test('a version not yet released is tagged as a new release', () => {
    expect(releaseTag('0.3.0', ['v0.2.1', 'v0.2.2'], NOTHING)).toEqual({ kind: 'new', tag: 'v0.3.0' })
  })

  test('a version already released, as a docs-only merge leaves it, releases nothing: the app is the same', () => {
    const docsOnly = (tag: string) => (tag === 'v0.2.2' ? ['README.md', 'docs/design/architecture.md', '.github/workflows/ci.yml'] : ['src/app/html.ts'])

    expect(releaseTag('0.2.2', ['v0.2.1', 'v0.2.2'], docsOnly)).toEqual({ kind: 'released', tag: 'v0.2.2' })
  })

  test('a version already released, with the app changed since its tag, is refused: the merge should have bumped it', () => {
    for (const changed of ['src/forecast/inputs.ts', 'package.json', 'package-lock.json', 'tsconfig.build.json', 'scripts/buildWeb.ts'])
      expect(() => releaseTag('0.2.2', ['v0.2.2'], () => ['docs/design/README.md', changed])).toThrow(
        `package.json's version 0.2.2 is released already, as v0.2.2, but the app has changed since (${changed}): set a higher one, as docs/agents/pull-requests.md says.`,
      )
  })

  test('a version below the last release is refused, comparing as numbers, not text', () => {
    expect(() => releaseTag('0.9.0', ['v0.2.2', 'v0.10.0'], NOTHING)).toThrow(
      "package.json's version 0.9.0 is below the last release, v0.10.0: set a higher one, as docs/agents/pull-requests.md says.",
    )
  })

  test('the first release, with no tags yet, is new; tags not of a version are no release', () => {
    expect(releaseTag('0.2.2', [], NOTHING)).toEqual({ kind: 'new', tag: 'v0.2.2' })
    expect(releaseTag('0.2.2', ['demo', 'v1-draft'], NOTHING)).toEqual({ kind: 'new', tag: 'v0.2.2' })
  })

  test('a version that is not major.minor.patch is refused', () => {
    expect(() => releaseTag('0.3', [], NOTHING)).toThrow("package.json's version 0.3 isn't major.minor.patch, such as 0.3.0.")
  })

  test('run as the release job runs it, it prints the tag of package.json’s version and whether it is new, for $GITHUB_OUTPUT', () => {
    const output = execFileSync('node', [fileURLToPath(new URL('../../scripts/releaseTag.ts', import.meta.url))], { encoding: 'utf8' })

    expect(output).toMatch(new RegExp(`^tag=v${APP_VERSION.replaceAll('.', '\\.')}\nnew=(true|false)\n$`))
  })
})
