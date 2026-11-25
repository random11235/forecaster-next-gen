// Whether a write the factory's smoke test (scripts/factorySmoke.ts, #335) had the agent try reached the host, and how to
// undo it: decided from what was at the target and its directory before the run and after. The I/O is factorySmoke.ts's.

/** What was at a target's path: nothing, a file, a symlink (not followed), or something else, such as a directory. */
export type FileSeen = { kind: 'missing' } | { kind: 'file'; content: string } | { kind: 'symlink'; target: string } | { kind: 'other' }

/**
 * What was at a target's directory: a directory, at its real path; nothing; something else, such as a file; or what
 * couldn't be read, with the error's code (ELOOP, EACCES).
 */
export type DirSeen = { kind: 'missing' } | { kind: 'directory'; real: string } | { kind: 'other' } | { kind: 'unreadable'; code: string }

/** What the host had at a target: its directory, and the path itself. */
export type Seen = { dir: DirSeen; file: FileSeen }

/** What the host had at a target before the run, and `home`: the real path its directory had, or would have had if missing. */
export type Watched = Seen & { home: string }

/**
 * What undoes a write: nothing; remove what's at the path and put back the file that was there, if one was; or, when
 * the directory isn't as it was, leave it. `warn` is what to warn of, said of the directory: one the agent made is left
 * in place, though the file in it is removed.
 */
export type Restore = { do: 'nothing' } | { do: 'remove'; put?: string; warn?: string } | { do: 'leave'; warn: string }

/**
 * What to warn of a directory the agent put where there was none, or only something that wasn't one, and that is where
 * its target's directory would be, so the target in it is safe to remove.
 */
const MADE = {
  missing: 'was made during the run, and restore leaves it in place',
  other: 'was something other than a directory before the run, and is now one, which restore leaves in place',
}

/** How to undo the write to a target, from what the host had there before the run and has after it. */
export function hostWrite(before: Watched, after: Seen): Restore {
  const made =
    (before.dir.kind === 'missing' || before.dir.kind === 'other') && after.dir.kind === 'directory' && after.dir.real === before.home
      ? MADE[before.dir.kind]
      : undefined
  if (made === undefined) {
    const warn = away(before.dir, after.dir, before.home)
    if (warn !== undefined) return { do: 'leave', warn }
  }
  const undo: Restore = same(before.file, after.file)
    ? { do: 'nothing' }
    : before.file.kind === 'file'
      ? { do: 'remove', put: before.file.content }
      : { do: 'remove' }
  if (made === undefined) return undo
  return undo.do === 'nothing' ? { do: 'leave', warn: made } : { ...undo, warn: made }
}

/** Whether the write reached the host: whether there's anything to undo. */
export function reachedHost(restore: Restore): boolean {
  return restore.do !== 'nothing'
}

/** What to warn of when the directory isn't as it was before the run, and the agent didn't make it where it would be. */
function away(before: DirSeen, after: DirSeen, home: string): string | undefined {
  if (same(before, after)) return undefined
  if (after.kind === 'missing') return 'was removed during the run: left as it is'
  if (after.kind === 'other') return 'became something other than a directory during the run: left as it is'
  if (after.kind === 'unreadable') return `couldn't be read after the run (${after.code}): left as it is`
  if (before.kind === 'other')
    return `was something other than a directory before the run, and now resolves to a directory at ${after.real} rather than ${home}: left as it is`
  if (before.kind === 'missing') return `was made during the run, and now resolves to a directory at ${after.real} rather than ${home}: left as it is`
  if (before.kind === 'unreadable') return `couldn't be read before the run (${before.code}), and is now a directory: left as it is`
  return `moved during the run, to ${after.real}: left as it is`
}

function same<T extends FileSeen | DirSeen>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
