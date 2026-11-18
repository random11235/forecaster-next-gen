import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { spawnSync } from 'node:child_process'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GIT_ENV, gitIn, newRepo, tempDir } from './releaseRepo.ts'

// Run as the release job runs it: `node scripts/release.ts <the commit its CI run checked>`, from a fresh clone of
// main's tip. Here GitHub is a bare repo of its own, and a developer's clone merges pull requests into it as GitHub's
// merge button does, so the real repo's history never decides whether the tests pass.
describe('the release, run as the release job runs it', () => {
  const script = fileURLToPath(new URL('../../scripts/release.ts', import.meta.url))
  const made: string[] = []
  const dir = () => {
    const each = tempDir()
    made.push(each)
    return each
  }
  let github: string
  let dev: ReturnType<typeof newRepo>

  beforeEach(() => {
    github = dir()
    gitIn(github)('init', '-q', '--bare', '-b', 'main')
    dev = newRepo(dir(), github)
    const lock = { name: 'forecaster', version: '0.2.6', lockfileVersion: 3, packages: { '': { name: 'forecaster', version: '0.2.6' } } }
    dev.commit({
      'package.json': `${JSON.stringify({ name: 'forecaster', version: '0.2.6', private: true }, null, 2)}\n`,
      'package-lock.json': `${JSON.stringify(lock, null, 2)}\n`,
      'CHANGELOG.md': '# Changelog\n\nWhat each version of the app shipped, newest first.\n\n## 0.2.6 (2026-11-16)\n\n- No import cycles (#230, PR #286)\n',
      'src/app.ts': 'export const APP = 1\n',
    })
    dev.git('tag', 'v0.2.6')
    dev.git('push', '-q', 'origin', 'main', 'v0.2.6')
  })

  afterEach(() => {
    for (const each of made.splice(0)) rmSync(each, { recursive: true, force: true })
  })

  /** Merges pull request `pr` from `branch` on GitHub, onto main as it is there now; gives the merge, which CI checks. */
  const land = (pr: number, branch: string): string => {
    dev.git('pull', '-q', '--ff-only', 'origin', 'main')
    const merge = dev.merge(pr, branch)
    dev.git('push', '-q', 'origin', 'main')
    return merge
  }
  /** The release job's checkout of main's tip, as actions/checkout makes it. */
  const checkout = (): string => newRepo(dir(), github).dir
  /** The release job of the CI run that checked `checked`, from `runner`'s checkout. */
  const release = (checked: string, runner = checkout()) => spawnSync('node', [script, checked], { cwd: runner, env: GIT_ENV, encoding: 'utf8' })
  /** Git on GitHub's copy. */
  const onGithub = (...args: string[]) => gitIn(github)(...args)
  const mainLog = (count: number) => onGithub('log', '--first-parent', '--format=%s', `-${count}`, 'main').split('\n')

  test('each merge’s run releases it on top of main, its version set and its change file gone; the next merge has no conflict with it', () => {
    const fix = dev.pullRequest(287, 'patch', 'A fix nobody sees (#287)')
    const visible = dev.pullRequest(288, 'minor', 'A visible change (#288)')

    expect(release(land(301, fix))).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\n' })
    expect(release(land(302, visible))).toMatchObject({ status: 0, stdout: 'tag=v0.3.0\n' })

    expect(mainLog(4)).toEqual([
      'Version 0.3.0',
      'Merge pull request #302 from random11235/spec/288',
      'Version 0.2.7',
      'Merge pull request #301 from random11235/spec/287',
    ])
    expect(onGithub('rev-parse', 'v0.2.7^{commit}')).toBe(onGithub('rev-parse', 'main~2'))
    expect(onGithub('rev-parse', 'v0.3.0^{commit}')).toBe(onGithub('rev-parse', 'main'))
    expect(JSON.parse(onGithub('show', 'v0.3.0:package.json'))).toMatchObject({ version: '0.3.0' })
    expect(onGithub('show', 'v0.3.0:CHANGELOG.md')).toContain('- A fix nobody sees (#287, PR #301)')
    expect(onGithub('show', 'v0.3.0:CHANGELOG.md')).toContain('- A visible change (#288, PR #302)')
    expect(onGithub('ls-tree', '-r', '--name-only', 'main', '--', 'changes')).toBe('')
  })

  test('two merges in before either’s run releases release as two versions, each by its own run, in merge order', () => {
    const fix = dev.pullRequest(287, 'patch', 'A fix nobody sees (#287)')
    const visible = dev.pullRequest(288, 'minor', 'A visible change (#288)')
    const first = land(301, fix)
    const second = land(302, visible)

    expect(release(first)).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\n' })
    // the second merge's code is in the tag, its line not: its own run, still going when the tag was made, releases it
    expect(onGithub('show', 'v0.2.7:CHANGELOG.md')).not.toContain('#288')
    expect(onGithub('ls-tree', '--name-only', 'v0.2.7', '--', 'changes/')).toBe('changes/288.md')
    expect(release(second)).toMatchObject({ status: 0, stdout: 'tag=v0.3.0\n' })

    expect(mainLog(4)).toEqual([
      'Version 0.3.0',
      'Version 0.2.7',
      'Merge pull request #302 from random11235/spec/288',
      'Merge pull request #301 from random11235/spec/287',
    ])
    expect(onGithub('show', 'v0.3.0:CHANGELOG.md')).toContain('- A visible change (#288, PR #302)')
  })

  test('a change file a red run left on main releases with the next merge’s green run, whose checked tree holds it', () => {
    const red = land(301, dev.pullRequest(287, 'patch', 'A fix nobody sees (#287)'))
    dev.git('checkout', '-q', '-b', 'docs/readme')
    dev.commit({ 'README.md': 'How to run it\n' })
    dev.git('checkout', '-q', 'main')

    expect(release(land(303, 'docs/readme'))).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\n' })
    expect(onGithub('show', 'v0.2.7:CHANGELOG.md')).toContain('- A fix nobody sees (#287, PR #301)')
    // the red run, re-run once fixed, finds it released, and leaves main as it is
    const released = onGithub('rev-parse', 'main')
    expect(release(red)).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\n' })
    expect(onGithub('rev-parse', 'main')).toBe(released)
  })

  test('a docs-only merge after a release releases nothing', () => {
    expect(release(land(301, dev.pullRequest(287, 'patch', 'A fix (#287)')))).toMatchObject({ status: 0 })
    dev.git('checkout', '-q', '-b', 'docs/readme')
    dev.commit({ 'README.md': 'How to run it\n' })
    dev.git('checkout', '-q', 'main')
    const docs = land(303, 'docs/readme')

    // the last release's tag all the same, so the job can publish it if its GitHub release is missing
    expect(release(docs)).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\n' })
    expect(onGithub('rev-parse', 'main')).toBe(docs)
  })

  test('an app change with no change file, as a push straight to main leaves, releases nothing: the check before merge is its guard', () => {
    dev.git('pull', '-q', '--ff-only', 'origin', 'main')
    const pushed = dev.commit({ 'src/app.ts': 'export const APP = 2\n' }, 'A fix pushed straight to main')
    dev.git('push', '-q', 'origin', 'main')

    expect(release(pushed)).toMatchObject({ status: 0, stdout: 'tag=v0.2.6\n' })
    expect(onGithub('rev-parse', 'main')).toBe(pushed)
  })

  test('a merge in while the release runs refuses its push: it makes the release again on the new tip, and pushes that', () => {
    const fix = dev.pullRequest(287, 'patch', 'A fix nobody sees (#287)')
    const later = dev.pullRequest(289, 'minor', 'A later change (#289)')
    const checked = land(301, fix)
    const runner = checkout()
    land(303, later)

    expect(release(checked, runner)).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\n' })
    expect(mainLog(3)).toEqual(['Version 0.2.7', 'Merge pull request #303 from random11235/spec/289', 'Merge pull request #301 from random11235/spec/287'])
    expect(onGithub('ls-tree', '--name-only', 'main', '--', 'changes/')).toBe('changes/289.md')
  })

  test('a push still refused after three tries fails the release, saying so, with no tag left on GitHub', () => {
    const checked = land(301, dev.pullRequest(287, 'patch', 'A fix (#287)'))
    writeFileSync(join(github, 'hooks/pre-receive'), '#!/bin/sh\necho "main is locked" >&2\nexit 1\n')
    chmodSync(join(github, 'hooks/pre-receive'), 0o755)

    const refused = release(checked)
    expect(refused).toMatchObject({ status: 1, stdout: '' })
    expect(refused.stderr).toContain('main is locked')
    expect(refused.stderr).toContain("Couldn't push v0.2.7 to main after 3 tries: re-run the release job.")
    expect(onGithub('tag', '--list')).toBe('v0.2.6')
  })
})
