// Whose words the factory (.github/workflows/factory.yml) believes. The repo is public, so anyone can comment on an
// issue: only the owner's and collaborators' text reaches an agent's prompt (ADR 0005, risk R2 in
// docs/research/sandcastle-factory.md), or tells the factory a ticket merged. Every comment the factory makes carries
// FACTORY_MARK: its token may be the owner's, so the mark is how its comments are told from the owner's.

/** GitHub's author association: how the author of an issue or comment is related to the repo. */
export type Association = 'OWNER' | 'MEMBER' | 'COLLABORATOR' | 'CONTRIBUTOR' | 'FIRST_TIME_CONTRIBUTOR' | 'FIRST_TIMER' | 'MANNEQUIN' | 'NONE'

/** The hidden mark every comment the factory makes carries, as MARK in the workflow. */
export const FACTORY_MARK = '<!-- forecaster-factory -->'

/** Whether the author is the owner or one of the repo's collaborators. */
export const isTrusted = (association: Association): boolean => association === 'OWNER' || association === 'MEMBER' || association === 'COLLABORATOR'

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
