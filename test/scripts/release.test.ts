import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { execFileSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { mergedChangeFiles, nextRelease } from '../../scripts/release.ts'
import { changeFileText, GIT_ENV, rawGitIn, repoAt, tempDir } from './releaseRepo.ts'

/** A change file of `bump` on main, brought by PR `pr`. */
const change = (bump: string, line: string, pr?: number, path = 'changes/230.md') => ({ path, text: changeFileText(bump, line), pr })
const DATE = '2026-11-17'

// The release job (.github/workflows/ci.yml) sets the version from the change files on main: the biggest bump over the
// last release, which every screen's footer then shows, so the EM names the release by what the app says.
describe('the release the change files make', () => {
  test('each bump raises its part of the last release, comparing tags as numbers, not text', () => {
    const tags = ['v0.2.2', 'v0.10.0', 'v0.9.0']
    const release = (bump: string) => nextRelease({ version: '0.10.0', tags, merged: [change(bump, 'A change (#1)')], date: DATE })

    expect(release('patch')).toMatchObject({ version: '0.10.1', tag: 'v0.10.1' })
    expect(release('minor')).toMatchObject({ version: '0.11.0', tag: 'v0.11.0' })
    expect(release('major')).toMatchObject({ version: '1.0.0', tag: 'v1.0.0' })
  })

  test('the biggest bump among the change files decides', () => {
    const merged = [change('patch', 'A fix (#1)', 1, 'changes/1.md'), change('minor', 'A visible change (#2)', 2, 'changes/2.md'), change('patch', 'B (#3)')]

    expect(nextRelease({ version: '0.2.6', tags: ['v0.2.6'], merged, date: DATE })).toMatchObject({ version: '0.3.0' })
  })

  test('its CHANGELOG.md section is dated, with one line per change file in the order given, each with the PR that merged it', () => {
    const merged = [
      change('patch', 'No import cycles in `src/`, with no change to the app (#230)', 286, 'changes/230.md'),
      change('patch', 'Each merge to main is a release (#239, #241)', 284, 'changes/239.md'),
      change('patch', 'A line naming no ticket', 290, 'changes/fix.md'),
      change('patch', 'A change pushed straight to main (#231)', undefined, 'changes/231.md'),
    ]

    expect(nextRelease({ version: '0.2.6', tags: ['v0.2.6'], merged, date: DATE })?.section).toBe(
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
    expect(nextRelease({ version: '0.2.6', tags: ['v0.2.6'], merged: [], date: DATE })).toBeUndefined()
  })

  test('the first release, with no tag of a version yet, raises package.json’s version', () => {
    expect(nextRelease({ version: '0.2.6', tags: ['demo', 'v1-draft'], merged: [change('patch', 'A fix (#1)')], date: DATE })).toMatchObject({
      version: '0.2.7',
      tag: 'v0.2.7',
    })
  })

  test('a change file that can’t be read, as a push straight to main could leave one, stops the release, naming it', () => {
    expect(() => nextRelease({ version: '0.2.6', tags: ['v0.2.6'], merged: [change('huge', 'A fix (#1)')], date: DATE })).toThrow(
      'changes/230.md has no valid bump',
    )
  })

  test('a package.json version that isn’t major.minor.patch, with no release to raise, stops the release', () => {
    expect(() => nextRelease({ version: '0.3', tags: [], merged: [change('patch', 'A fix (#1)')], date: DATE })).toThrow(
      "package.json's version 0.3 isn't major.minor.patch, such as 0.3.0.",
    )
  })
})

// Which change files a release takes, from a checkout of main's tip, and the PR that brought each onto main: here in a
// repo of its own, its main made of merges as GitHub's merge button makes them.
describe('the change files on main a release takes', () => {
  let main: ReturnType<typeof repoAt>

  beforeEach(() => {
    const dir = tempDir()
    execFileSync('git', ['init', '-q', '-b', 'main', dir], { env: GIT_ENV })
    main = repoAt(dir)
    main.commit({ 'src/app.ts': 'export const APP = 1\n' })
  })

  afterEach(() => {
    rmSync(main.dir, { recursive: true, force: true })
  })

  const taken = (checked = main.git('rev-parse', 'HEAD')) => mergedChangeFiles(rawGitIn(main.dir), checked)

  test('in merge order, one merge’s in ticket order, each with the PR that merged it into main, an integration branch’s tickets its PR', () => {
    const later = main.pullRequest(1001, 'patch', 'A later ticket (#1001)')
    const earlier = main.pullRequest(290, 'patch', 'An earlier ticket (#290)')
    main.git('checkout', '-q', '-b', 'spec/235')
    main.merge(311, later)
    main.merge(312, earlier)
    main.git('checkout', '-q', 'main')
    const visible = main.pullRequest(9, 'minor', 'A visible change (#9)')
    main.merge(320, 'spec/235')
    main.merge(321, visible)

    expect(taken()).toEqual([
      { path: 'changes/290.md', text: changeFileText('patch', 'An earlier ticket (#290)'), pr: 320 },
      { path: 'changes/1001.md', text: changeFileText('patch', 'A later ticket (#1001)'), pr: 320 },
      { path: 'changes/9.md', text: changeFileText('minor', 'A visible change (#9)'), pr: 321 },
    ])
  })

  test('only those the commit CI checked holds too: a merge after it is left to its own run', () => {
    const fix = main.pullRequest(287, 'patch', 'A fix (#287)')
    const visible = main.pullRequest(288, 'minor', 'A visible change (#288)')
    const checked = main.merge(301, fix)
    main.merge(302, visible)

    expect(taken(checked).map(({ path }) => path)).toEqual(['changes/287.md'])
  })

  test('one a push straight to main added has no PR, and keeps its place among the merges', () => {
    main.merge(301, main.pullRequest(287, 'patch', 'A fix (#287)'))
    main.commit({ 'changes/hotfix.md': changeFileText('patch', 'A hotfix') }, 'A hotfix, pushed to main')
    main.merge(302, main.pullRequest(288, 'patch', 'Another fix (#288)'))

    expect(taken().map(({ path, pr }) => ({ path, pr }))).toEqual([
      { path: 'changes/287.md', pr: 301 },
      { path: 'changes/hotfix.md', pr: undefined },
      { path: 'changes/288.md', pr: 302 },
    ])
  })

  test('one a merge renamed has that merge’s PR, as the merge that brought it under its name', () => {
    main.commit({ 'changes/draft.md': changeFileText('patch', 'A fix, its ticket named later (#290)') }, 'A change file with no ticket yet')
    main.git('checkout', '-q', '-b', 'spec/290')
    main.git('mv', 'changes/draft.md', 'changes/290.md')
    main.git('commit', '-q', '-m', 'Name its ticket')
    main.git('checkout', '-q', 'main')
    main.merge(305, 'spec/290')

    expect(taken().map(({ path, pr }) => ({ path, pr }))).toEqual([{ path: 'changes/290.md', pr: 305 }])
  })
})
