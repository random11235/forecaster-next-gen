// Bumps, as docs/agents/pull-requests.md#version sets them out, and how the change-file check reads a branch: the
// vocabulary scripts/changeFiles.ts, scripts/bumpFloors.ts and scripts/release.ts share.

/** How big a change is: the part of the version a release raises, smallest first. */
export const BUMPS = ['patch', 'minor', 'major'] as const
export type Bump = (typeof BUMPS)[number]

/** Where `bump` comes among the bumps, smallest first: a bigger bump, a bigger rank. */
export const rank = (bump: Bump): number => BUMPS.indexOf(bump)

/** The biggest of `bumps`, the part of the version a release of them all raises; none, undefined. */
export function biggestBump(bumps: readonly Bump[]): Bump | undefined {
  return [...BUMPS].reverse().find((each) => bumps.includes(each))
}

/** A bump a branch needs at least, and why, as the check's message says it: "This branch <why>". */
export type Need = { bump: Bump; why: string }

/** A file as a branch's base or head holds it, or undefined where it holds none. */
export type ReadAt = (path: string, at: 'base' | 'head') => string | undefined
