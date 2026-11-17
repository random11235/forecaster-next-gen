import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { nextRelease } from '../../scripts/releaseTag.ts'

/** A change file of `bump` on main, brought by PR `pr`. */
const change = (bump: string, line: string, pr?: number, path = 'changes/230.md') => ({ path, text: `---\nbump: ${bump}\n---\n\n${line}\n`, pr })

// The release job (.github/workflows/ci.yml) sets the version from the change files on main's tip: the highest bump
// over the last release, which every screen's footer then shows, so the EM names the release by what the app says.
describe('the release the change files on main make', () => {
  test('each bump raises its part of the last release, comparing tags as numbers, not text', () => {
    const tags = ['v0.2.2', 'v0.10.0', 'v0.9.0']

    expect(nextRelease('0.10.0', tags, [change('patch', 'A fix (#1)')], '2026-11-17')).toMatchObject({ version: '0.10.1', tag: 'v0.10.1' })
    expect(nextRelease('0.10.0', tags, [change('minor', 'A visible change (#1)')], '2026-11-17')).toMatchObject({ version: '0.11.0', tag: 'v0.11.0' })
    expect(nextRelease('0.10.0', tags, [change('major', 'A one-way door (#1)')], '2026-11-17')).toMatchObject({ version: '1.0.0', tag: 'v1.0.0' })
  })

  test('the biggest bump among the change files decides', () => {
    const merged = [change('patch', 'A fix (#1)', 1, 'changes/1.md'), change('minor', 'A visible change (#2)', 2, 'changes/2.md'), change('patch', 'B (#3)')]

    expect(nextRelease('0.2.6', ['v0.2.6'], merged, '2026-11-17')).toMatchObject({ version: '0.3.0' })
  })

  test('its CHANGELOG.md section is dated, with one line per change file in merge order, each with the PR that merged it', () => {
    const merged = [
      change('patch', 'No import cycles in `src/`, with no change to the app (#230)', 286, 'changes/230.md'),
      change('patch', 'Each merge to main is a release (#239, #241)', 284, 'changes/239.md'),
      change('patch', 'A line naming no ticket', 290, 'changes/fix.md'),
      change('patch', 'A change pushed straight to main (#231)', undefined, 'changes/231.md'),
    ]

    expect(nextRelease('0.2.6', ['v0.2.6'], merged, '2026-11-17')?.section).toBe(
      [
        '## 0.2.7 (2026-11-17)',
        '',
        '- No import cycles in `src/`, with no change to the app (#230, PR #286)',
        '- Each merge to main is a release (#239, #241, PR #284)',
        '- A line naming no ticket (PR #290)',
        '- A change pushed straight to main (#231)',
        '',
      ].join('\n'),
    )
  })

  test('no change files, as a docs-only merge leaves main, release nothing', () => {
    expect(nextRelease('0.2.6', ['v0.2.6'], [], '2026-11-17')).toBeUndefined()
  })

  test('the first release, with no tag of a version yet, raises package.json’s version', () => {
    expect(nextRelease('0.2.6', ['demo', 'v1-draft'], [change('patch', 'A fix (#1)')], '2026-11-17')).toMatchObject({ version: '0.2.7', tag: 'v0.2.7' })
  })

  test('a change file that can’t be read, as a push straight to main could leave one, stops the release, naming it', () => {
    expect(() => nextRelease('0.2.6', ['v0.2.6'], [change('huge', 'A fix (#1)')], '2026-11-17')).toThrow('changes/230.md has no valid bump')
  })

  test('a package.json version that isn’t major.minor.patch, with no release to raise, stops the release', () => {
    expect(() => nextRelease('0.3', [], [change('patch', 'A fix (#1)')], '2026-11-17')).toThrow(
      "package.json's version 0.3 isn't major.minor.patch, such as 0.3.0.",
    )
  })
})

// Run as the release job runs it, from the root of a checkout of main's tip: here a repo of its own, with the tags,
// branches and merges each case needs, so the real repo's never decide whether the tests pass.
describe('the release, run as the release job runs it', () => {
  const script = fileURLToPath(new URL('../../scripts/releaseTag.ts', import.meta.url))
  let repo: string
  // Without git's own variables: run from a git hook (pre-push runs the tests), GIT_DIR and the like name the real
  // repo, and git would init, commit and tag there in place of the repo of its own. Nor the developer's global or system
  // config (signed tags, a hooks path): the repo's own config, its committer included, is all git reads. Every commit
  // is made at one time, late on 2026-11-17 in New Zealand, already 2026-11-17 in UTC too.
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_COMMITTER_DATE: '2026-11-18T09:30:00+13:00',
  }

  const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim()
  const read = (path: string): string => readFileSync(join(repo, path), 'utf8')
  /** Writes each of `files` and commits them, on the branch checked out. */
  const commit = (files: Record<string, string>): void => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(repo, path, '..'), { recursive: true })
      writeFileSync(join(repo, path), text)
    }
    git('add', '.')
    git('commit', '-q', '-m', Object.keys(files).join(', '))
  }
  /** A pull request's branch, cut from main as it is now, that changes the app and adds its change file. */
  const pullRequest = (ticket: number, bump: string, line: string): string => {
    const name = `spec/${ticket}`
    git('checkout', '-q', '-b', name, 'main')
    commit({ [`src/${ticket}.ts`]: `export const TICKET = ${ticket}\n`, [`changes/${ticket}.md`]: `---\nbump: ${bump}\n---\n\n${line}\n` })
    git('checkout', '-q', 'main')
    return name
  }
  /** Merges pull request `pr` from `branch` into main as GitHub does, failing on a conflict. */
  const merge = (pr: number, branch: string): void => {
    git('merge', '-q', '--no-ff', '-m', `Merge pull request #${pr} from random11235/${branch}`, branch)
  }
  const release = () => spawnSync('node', [script], { cwd: repo, env, encoding: 'utf8' })
  const lock = (version: string) =>
    `${JSON.stringify({ name: 'forecaster', version, lockfileVersion: 3, packages: { '': { name: 'forecaster', version } } }, null, 2)}\n`
  const HEADER = '# Changelog\n\nWhat each version of the app shipped, newest first.\n\n'
  const RELEASED = '## 0.2.6 (2026-11-16)\n\n- No import cycles in `src/` (#230, PR #286)\n'

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'forecaster-release-'))
    git('init', '-q', '-b', 'main')
    git('config', 'user.name', 'Test')
    git('config', 'user.email', 'test@example.com')
    commit({
      'package.json': `${JSON.stringify({ name: 'forecaster', version: '0.2.6', private: true }, null, 2)}\n`,
      'package-lock.json': lock('0.2.6'),
      'CHANGELOG.md': `${HEADER}${RELEASED}`,
      'src/app.ts': 'export const APP = 1\n',
    })
    git('tag', 'v0.2.6')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test('two pull requests that change the app merge one after the other with no conflict, and release as two versions in merge order', () => {
    const fix = pullRequest(287, 'patch', 'A fix nobody sees (#287)')
    const visible = pullRequest(288, 'minor', 'A visible change (#288)')

    merge(301, fix)
    expect(release()).toMatchObject({ status: 0, stdout: 'tag=v0.2.7\nnew=true\n' })
    merge(302, visible)
    expect(release()).toMatchObject({ status: 0, stdout: 'tag=v0.3.0\nnew=true\n' })

    expect(JSON.parse(read('package.json'))).toMatchObject({ version: '0.3.0' })
    expect(read('package-lock.json')).toBe(lock('0.3.0'))
    expect(read('CHANGELOG.md')).toBe(
      `${HEADER}## 0.3.0 (2026-11-17)\n\n- A visible change (#288, PR #302)\n\n## 0.2.7 (2026-11-17)\n\n- A fix nobody sees (#287, PR #301)\n\n${RELEASED}`,
    )
    expect(existsSync(join(repo, 'changes'))).toBe(false)
    expect(git('status', '--porcelain')).toBe('')
    // each release is a commit of its own on main, after the merge it releases, and carries its tag
    expect(git('log', '--first-parent', '--format=%s', '-4').split('\n')).toEqual([
      'Version 0.3.0',
      'Merge pull request #302 from random11235/spec/288',
      'Version 0.2.7',
      'Merge pull request #301 from random11235/spec/287',
    ])
    expect(git('rev-parse', 'v0.3.0^{commit}')).toBe(git('rev-parse', 'HEAD'))
    expect(git('rev-parse', 'v0.2.7^{commit}')).toBe(git('rev-parse', 'HEAD~2'))
  })

  test('a docs-only merge, with no change file, releases nothing: no commit, no tag', () => {
    git('checkout', '-q', '-b', 'docs/readme')
    commit({ 'README.md': 'How to run it\n' })
    git('checkout', '-q', 'main')
    merge(303, 'docs/readme')
    const tip = git('rev-parse', 'HEAD')

    expect(release()).toMatchObject({ status: 0, stdout: 'new=false\n' })
    expect(git('rev-parse', 'HEAD')).toBe(tip)
    expect(git('tag', '--list')).toBe('v0.2.6')
  })

  test('merges in before the release runs release together: in merge order, one merge’s in ticket order, each with the PR that merged it into main', () => {
    // an integration branch whose tickets merged into it by PRs of their own, then into main by one PR
    const later = pullRequest(1001, 'patch', 'A later ticket (#1001)')
    const earlier = pullRequest(290, 'patch', 'An earlier ticket (#290)')
    git('checkout', '-q', '-b', 'spec/235', 'main')
    merge(311, later)
    merge(312, earlier)
    git('checkout', '-q', 'main')
    const visible = pullRequest(9, 'minor', 'A visible change (#9)')

    merge(320, 'spec/235')
    merge(321, visible)

    expect(release()).toMatchObject({ status: 0, stdout: 'tag=v0.3.0\nnew=true\n' })
    expect(read('CHANGELOG.md')).toContain(
      '## 0.3.0 (2026-11-17)\n\n- An earlier ticket (#290, PR #320)\n- A later ticket (#1001, PR #320)\n- A visible change (#9, PR #321)\n\n## 0.2.6',
    )
  })
})
