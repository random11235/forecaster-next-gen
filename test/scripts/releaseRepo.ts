import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// What the release tests share: a change file's text, and git repos of their own standing in for GitHub's, with the
// branches, merges and tags each case needs, so the real repo's never decide whether a test passes.

/** A change file, as docs/agents/pull-requests.md#version sets it out: front matter setting `bump`, then its line. */
export const changeFileText = (bump: string, line: string): string => `---\nbump: ${bump}\n---\n\n${line}\n`

/**
 * Git's environment for the repos: without git's own variables (run from a git hook, as pre-push runs the tests,
 * GIT_DIR and the like name the real repo, and git would commit and tag there), nor the developer's global or system
 * config (signed tags, a hooks path). Every commit is by one committer, at one time: the morning of 2026-11-18 in New
 * Zealand, still 2026-11-17 in UTC, so a release's section, dated by the UTC day, says 2026-11-17.
 */
export const GIT_ENV = {
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_DATE: '2026-11-18T09:30:00+13:00',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

/** A fresh, empty directory for a repo. */
export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'forecaster-release-'))

/** Git in the repo at `dir`, giving its output as it is, as the release itself runs git. */
export const rawGitIn =
  (dir: string) =>
  (...args: string[]): string =>
    execFileSync('git', args, { cwd: dir, env: GIT_ENV, encoding: 'utf8' })

/** Git in the repo at `dir`, giving its output trimmed. */
export const gitIn =
  (dir: string) =>
  (...args: string[]): string =>
    rawGitIn(dir)(...args).trim()

/** The repo at `dir`, already made, worked on as a developer and GitHub's merge button would. */
export function repoAt(dir: string) {
  const git = gitIn(dir)
  /** Writes each of `files` and commits them on the branch checked out, giving the commit. */
  const commit = (files: Record<string, string>, message = Object.keys(files).join(', ')): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(dir, path, '..'), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    git('add', '.')
    git('commit', '-q', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  /** A pull request's branch, cut from `from` as it is now, that changes the app and adds its change file. */
  const pullRequest = (ticket: number, bump: string, line: string, from = 'main'): string => {
    const branch = `spec/${ticket}`
    const back = git('branch', '--show-current')
    git('checkout', '-q', '-b', branch, from)
    commit({ [`src/${ticket}.ts`]: `export const TICKET = ${ticket}\n`, [`changes/${ticket}.md`]: changeFileText(bump, line) })
    git('checkout', '-q', back)
    return branch
  }
  /** Merges pull request `pr` from `branch` into the branch checked out, as GitHub does, giving the merge. */
  const merge = (pr: number, branch: string): string => {
    git('merge', '-q', '--no-ff', '-m', `Merge pull request #${pr} from random11235/${branch}`, branch)
    return git('rev-parse', 'HEAD')
  }
  return { dir, git, commit, pullRequest, merge }
}

/** A new repo at `dir`: a clone of the repo at `from`, or with no `from` an empty one whose branch is main. */
export function newRepo(dir = tempDir(), from?: string) {
  const repo = repoAt(dir)
  if (from === undefined) repo.git('init', '-q', '-b', 'main')
  else repo.git('clone', '-q', from, '.')
  return repo
}
