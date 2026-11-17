import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { releaseTag } from '../../scripts/releaseTag.ts'
import { APP_VERSION } from '../../src/forecast/appVersion.js'

/** `changedSince` for a merge with no file changed since any tag: whether the app changed doesn't arise. */
const NO_CHANGES = (): readonly string[] => []

// The release job (.github/workflows/ci.yml) tags each merge to main with the app's version, `version` in
// package.json, which every screen's footer shows, so the EM names the release by what the app says.
describe('the release tag for a merge to main', () => {
  test('a version not yet released is tagged as a new release', () => {
    expect(releaseTag('0.3.0', ['v0.2.1', 'v0.2.2'], NO_CHANGES)).toEqual({ kind: 'new', tag: 'v0.3.0' })
  })

  test('a version already released, as a docs-only merge leaves it, releases nothing: the app is the same', () => {
    const docsOnly = (tag: string) =>
      tag === 'v0.2.2'
        ? ['README.md', 'docs/design/architecture.md', '.github/workflows/ci.yml', 'tsconfig.json', 'test/app/smoke.test.ts']
        : ['src/app/html.ts']

    expect(releaseTag('0.2.2', ['v0.2.1', 'v0.2.2'], docsOnly)).toEqual({ kind: 'released', tag: 'v0.2.2' })
  })

  test('a version already released, with the app changed since its tag, is refused: the merge should have bumped it', () => {
    for (const changed of ['src/forecast/inputs.ts', 'package.json', 'package-lock.json', 'tsconfig.build.json', 'scripts/buildWeb.ts'])
      expect(() => releaseTag('0.2.2', ['v0.2.2'], () => ['docs/design/README.md', changed])).toThrow(
        `package.json's version 0.2.2 is released already, as v0.2.2, but the app has changed since (${changed}): set a higher one, as docs/agents/pull-requests.md says.`,
      )
  })

  test('a version below the last release is refused, comparing as numbers, not text', () => {
    expect(() => releaseTag('0.9.0', ['v0.2.2', 'v0.10.0'], NO_CHANGES)).toThrow(
      "package.json's version 0.9.0 is below the last release, v0.10.0: set a higher one, as docs/agents/pull-requests.md says.",
    )
  })

  test('the first release, with no tags yet, is new; tags not of a version are no release', () => {
    expect(releaseTag('0.2.2', [], NO_CHANGES)).toEqual({ kind: 'new', tag: 'v0.2.2' })
    expect(releaseTag('0.2.2', ['demo', 'v1-draft'], NO_CHANGES)).toEqual({ kind: 'new', tag: 'v0.2.2' })
  })

  test('a version that is not major.minor.patch is refused', () => {
    expect(() => releaseTag('0.3', [], NO_CHANGES)).toThrow("package.json's version 0.3 isn't major.minor.patch, such as 0.3.0.")
  })
})

// Run as the release job runs it, from the root of a checkout: here a repo of its own, with the tags and commits each
// case needs, so the real repo's tags never decide whether the tests pass.
describe('the release tag, run as the release job runs it', () => {
  const script = fileURLToPath(new URL('../../scripts/releaseTag.ts', import.meta.url))
  const tag = `v${APP_VERSION}`
  let repo: string

  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: repo,
      encoding: 'utf8',
    })
  /** Commits `path`, made up, as a merge to main would bring it. */
  const commit = (path: string): void => {
    mkdirSync(join(repo, path, '..'), { recursive: true })
    writeFileSync(join(repo, path), `${path}\n`)
    git('add', path)
    git('commit', '-q', '-m', path)
  }
  const release = () => spawnSync('node', [script], { cwd: repo, encoding: 'utf8' })

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'forecaster-release-'))
    git('init', '-q')
    commit('README.md')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('prints the tag of package.json’s version and that it is new, for $GITHUB_OUTPUT, when no tag has it', () => {
    git('tag', 'v0.0.1')

    expect(release()).toMatchObject({ status: 0, stdout: `tag=${tag}\nnew=true\n` })
  })

  test('prints that it is not new when its tag has it and only docs changed since', () => {
    git('tag', tag)
    commit('docs/design/architecture.md')

    expect(release()).toMatchObject({ status: 0, stdout: `tag=${tag}\nnew=false\n` })
  })

  test('fails, saying to bump the version, when its tag has it and the app changed since', () => {
    git('tag', tag)
    commit('src/forecast/inputs.ts')

    const run = release()
    expect(run.status).not.toBe(0)
    expect(run.stderr).toContain('but the app has changed since (src/forecast/inputs.ts): set a higher one')
  })
})
