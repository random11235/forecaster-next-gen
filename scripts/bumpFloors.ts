// The bump a branch's diff shows it needs at least, beyond the patch any app change needs, as
// docs/agents/pull-requests.md#version sets out: a new migration step is a one-way door, so needs a major; a new demo
// screenshot ships with a visible change (docs/agents/demos.md), so needs a minor. The change-file check
// (changeFileProblems in scripts/changeFiles.ts) holds a branch's change files to these floors. The bump stays the
// author's to judge above them: a visible change with no screenshot, or a one-way door that isn't a migration step.
import type { Bump, ReadAt } from './changeFiles.ts'
import { MIGRATIONS_FILE, migrationSteps } from './migrationSteps.ts'

/** A bump a branch needs at least, and why, as the check's message says it: "This branch <why>". */
export type Need = { bump: Bump; why: string }

/** A demo screenshot, which a visible change ships (docs/agents/demos.md). */
const DEMO = /^docs\/demos\/[^/]+\.png$/

/** The floors the files a branch `changed` since its base set, read with `read`: none, an empty list. */
export function bumpFloors(changed: readonly string[], read: ReadAt): Need[] {
  const needs: Need[] = []
  const added = addedSteps(changed, read)
  if (added !== undefined) needs.push({ bump: 'major', why: added })
  // a changed path its base doesn't hold is one the branch adds (renames come as a deletion and an addition)
  const demos = changed.filter((path) => DEMO.test(path) && read(path, 'base') === undefined)
  if (demos.length > 0) needs.push({ bump: 'minor', why: `adds demo screenshots (${demos.join(', ')})` })
  return needs
}

/**
 * The migration steps the branch adds, as "adds migration step N", or undefined where it adds none. A side whose steps
 * can't be read sets no floor: the migration check (scripts/checkMigrations.ts) fails that branch, saying why.
 */
function addedSteps(changed: readonly string[], read: ReadAt): string | undefined {
  if (!changed.includes(MIGRATIONS_FILE)) return undefined
  const steps = (at: 'base' | 'head'): number | undefined => {
    const source = read(MIGRATIONS_FILE, at)
    try {
      return source === undefined ? 0 : migrationSteps(source, at).length
    } catch {
      return undefined
    }
  }
  const [base, head] = [steps('base'), steps('head')]
  if (base === undefined || head === undefined || head <= base) return undefined
  return head === base + 1 ? `adds migration step ${head}` : `adds migration steps ${base + 1}–${head}`
}
