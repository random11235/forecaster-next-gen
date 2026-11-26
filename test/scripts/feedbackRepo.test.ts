import { describe, expect, test } from 'vitest'
import { feedbackRepo } from '../../scripts/feedbackRepo.ts'

// The GitHub repo a build sends Feedback to (#370), as `npm run build` records it: GITHUB_REPOSITORY where the
// release job sets it, else the clone's origin, each read as `owner/repo`, or no repo at all.
describe("the build's repo", () => {
  test.each(['git@github.com:owner/repo.git', 'git@github.com:owner/repo', 'https://github.com/owner/repo.git', 'https://github.com/owner/repo'])(
    'origin %s gives owner/repo',
    (origin) => {
      expect(feedbackRepo({ origin })).toBe('owner/repo')
    },
  )

  test("GITHUB_REPOSITORY gives owner/repo, and wins over origin's", () => {
    expect(feedbackRepo({ githubRepository: 'owner/repo' })).toBe('owner/repo')
    expect(feedbackRepo({ githubRepository: 'fork/forecaster', origin: 'git@github.com:owner/repo.git' })).toBe('fork/forecaster')
  })

  test('a repo with dots, dashes and underscores is kept whole', () => {
    expect(feedbackRepo({ origin: 'https://github.com/random11235/forecaster-next-gen.git' })).toBe('random11235/forecaster-next-gen')
    expect(feedbackRepo({ origin: 'git@github.com:my_org/app.v2.git' })).toBe('my_org/app.v2')
  })

  test.each([
    ['another host', 'https://gitlab.com/owner/repo.git'],
    ['another host over SSH', 'git@gitlab.com:owner/repo.git'],
    ['a host ending in github.com', 'https://notgithub.com/owner/repo'],
    ['an empty value', ''],
    ['no owner', 'https://github.com/repo'],
    ['a path too deep', 'https://github.com/owner/repo/issues'],
    ['a malformed URL', 'https://github.com:owner/repo'],
    ['a query in the URL', 'https://github.com/owner/repo?x=1'],
    ['a name with a space', 'https://github.com/owner/my repo'],
  ])('%s gives no repo', (_, origin) => {
    expect(feedbackRepo({ origin })).toBeUndefined()
    expect(feedbackRepo({ githubRepository: origin })).toBeUndefined()
  })

  test('nothing set gives no repo, and an empty GITHUB_REPOSITORY falls back to origin', () => {
    expect(feedbackRepo({})).toBeUndefined()
    expect(feedbackRepo({ githubRepository: '', origin: 'git@github.com:owner/repo.git' })).toBe('owner/repo')
  })
})
