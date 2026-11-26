// Works out which GitHub repo the footer's "Send feedback" link should open an issue in (#370), and writes it
// into the compiled dist/app/feedbackRepo.js. `npm run build` runs this after tsc has built dist/.
//
// It uses GITHUB_REPOSITORY if that's set (as it is in CI), otherwise the clone's `origin` remote, otherwise no
// repo, in which case the footer shows no link. Because the release tarball ships dist/, a released app links
// to the repo it was released from, and a fork's build links to the fork, with no extra release step.
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const NAME = '[A-Za-z0-9_.-]+'
/** `owner/repo` alone (GITHUB_REPOSITORY), or GitHub's SSH or HTTPS remote for it, `.git` or not. */
const FORMS = [`^(${NAME}/${NAME})$`, `^git@github\\.com:(${NAME}/${NAME})$`, `^https://github\\.com/(${NAME}/${NAME})$`].map((form) => new RegExp(form))

/** `owner/repo` from GITHUB_REPOSITORY or a remote's URL; nothing for another host, an empty value or a malformed one. */
function repoOf(value: string | undefined): string | undefined {
  const repo = FORMS.map((form) => value?.trim().match(form)?.[1])
    .find(Boolean)
    ?.replace(/\.git$/, '')
  return repo?.split('/').every((part) => part !== '' && part !== '.' && part !== '..') ? repo : undefined
}

/** The build's repo: GITHUB_REPOSITORY's where it names one, else origin's, else none. */
export function feedbackRepo({ githubRepository, origin }: { githubRepository?: string | undefined; origin?: string | undefined }): string | undefined {
  return repoOf(githubRepository) ?? repoOf(origin)
}

/** origin's URL in the clone the build runs in, or nothing outside a clone or with no origin. */
function originUrl(): string | undefined {
  try {
    return execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return undefined
  }
}

if (import.meta.main) {
  const repo = feedbackRepo({ githubRepository: process.env.GITHUB_REPOSITORY, origin: originUrl() })
  // In place of what tsc built from src/app/feedbackRepo.ts, which records none, so the tests, run from src/, have none.
  const out = new URL('../dist/app/feedbackRepo.js', import.meta.url)
  writeFileSync(
    out,
    `/** The GitHub repo this build sends Feedback to, recorded by scripts/feedbackRepo.ts. */\nexport const FEEDBACK_REPO = ${JSON.stringify(repo)};\n`,
  )
  console.log(repo ? `Feedback goes to ${repo}` : 'No GitHub repo: the footer has no Send feedback link')
}
