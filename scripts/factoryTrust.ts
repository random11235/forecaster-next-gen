// Whose words the factory (.github/workflows/factory.yml) believes. The repo is public, so anyone can comment on an
// issue: only the owner's and collaborators' text reaches an agent's prompt (ADR 0005, risk R2 in
// docs/research/sandcastle-factory.md), or tells the factory a ticket merged. Every comment the factory makes carries
// FACTORY_MARK, which keeps it out of a prompt.
//
// The factory writes with its jobs' GITHUB_TOKEN, as github-actions[bot], whom GitHub gives no author association. So a
// merged comment counts when github-actions wrote it, as well as the owner or a collaborator by hand. GraphQL names it
// a Bot, which no user account can be, and only a workflow in this repo writes as github-actions here. That makes it
// the factory only while factory.yml is the one workflow whose jobs may write to issues. test/scripts/workflowPermissions.test.ts
// pins it: every workflow sets its own token read-only, and no job outside factory.yml grants `issues: write` or
// `write-all`.
//
// Triage's brief for a ticket is a comment carrying BRIEF_MARK, which only counts when github-actions wrote it: the
// owner's or a collaborator's by hand is a comment like any other, and anyone else's is left out.

/** GitHub's author association: how the author of an issue or comment is related to the repo. */
export type Association = 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'FIRST_TIME_CONTRIBUTOR' | 'FIRST_TIMER' | 'MANNEQUIN' | 'NONE'

/** The hidden mark every comment the factory makes carries, as MARK in the workflow. */
export const FACTORY_MARK = '<!-- forecaster-factory -->'

/** The hidden mark triage's brief for a ticket opens with: distinct from FACTORY_MARK, so the brief reaches a prompt. */
export const BRIEF_MARK = '<!-- forecaster-brief -->'

/** A comment's author, as GitHub's GraphQL API gives it: null for a deleted account. */
export type Author = { __typename: 'Bot' | 'User' | 'Mannequin' | 'Organization' | 'EnterpriseUserAccount'; login: string }

/** Whether the author is the owner or one of the repo's collaborators. */
export const isTrusted = (association: Association): boolean => association === 'OWNER' || association === 'MEMBER' || association === 'COLLABORATOR'

/** Whether the author is github-actions, the bot a workflow's GITHUB_TOKEN writes as: here, the factory's jobs. */
export const isActionsBot = (author: Author | null): boolean => author?.__typename === 'Bot' && author.login === 'github-actions'

/**
 * Whether a comment's author, as GitHub's REST API gives it, is github-actions: there, a Bot named `github-actions[bot]`,
 * a login no user account can have.
 */
export const isActionsBotUser = (user: { login: string; type: string }): boolean => user.type === 'Bot' && user.login === 'github-actions[bot]'

/**
 * The factory's words in a comment, after the mark it opens with, or undefined if it doesn't open with the mark. The
 * mark alone says nothing about who wrote it: anyone can type it, so check the author too.
 */
export const factoryWords = (body: string | null): string | undefined => {
  const text = (body ?? '').trimStart()
  return text.startsWith(FACTORY_MARK) ? text.slice(FACTORY_MARK.length).trim() : undefined
}

/** Whether the comment carries the factory's mark anywhere, so it is kept out of a prompt. */
export const byFactory = (body: string | null): boolean => (body ?? '').includes(FACTORY_MARK)

/**
 * The brief's words in a comment, after the mark it opens with, or undefined if it doesn't open with the mark. As with
 * factoryWords, anyone can type the mark, so check the author too.
 */
export const briefWords = (body: string | null): string | undefined => {
  const text = (body ?? '').trimStart()
  return text.startsWith(BRIEF_MARK) ? text.slice(BRIEF_MARK.length).trim() : undefined
}
