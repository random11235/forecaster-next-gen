// Whether a write the factory's smoke test (scripts/factorySmoke.ts, #335) had the agent try reached the host, and how to
// undo it: decided from what was at the target and its directory before the run and after. The I/O is factorySmoke.ts's.

/** What was at a target's path: nothing, a file, a symlink (not followed), or something else, such as a directory. */
export type FileSeen = { kind: 'missing' } | { kind: 'file'; content: string } | { kind: 'symlink'; target: string } | { kind: 'other' }

/** What was at a target's directory: a directory, at its real path; nothing; or something else, such as a file. */
export type DirSeen = { kind: 'missing' } | { kind: 'directory'; real: string } | { kind: 'other' }

/** What the host had at a target: its directory, and the path itself. */
export type Seen = { dir: DirSeen; file: FileSeen }

/**
 * What undoes a write: nothing; remove what's at the path and put back the file that was there, if one was; or, when
 * its directory isn't where it was, leave it, and warn why.
 */
export type Restore = { do: 'nothing' } | { do: 'remove'; put?: string } | { do: 'leave'; why: string }

/**
 * Whether the write to a target reached the host, and how to undo it. `home` is the real path its directory had before
 * the run, or would have had if missing then.
 */
export function hostWrite(home: string, before: Seen, after: Seen): { changed: boolean; restore: Restore } {
  const why = away(home, before.dir, after.dir)
  if (why !== undefined) return { changed: true, restore: { do: 'leave', why } }
  if (sameFile(before.file, after.file)) return { changed: false, restore: { do: 'nothing' } }
  return { changed: true, restore: before.file.kind === 'file' ? { do: 'remove', put: before.file.content } : { do: 'remove' } }
}

/** Why the directory isn't where it was before the run, or would have been if missing then; undefined if it is. */
function away(home: string, before: DirSeen, after: DirSeen): string | undefined {
  if (after.kind === 'missing') return before.kind === 'missing' ? undefined : 'was removed'
  if (after.kind === 'other') return 'is now something other than a directory'
  return after.real === home ? undefined : `moved, to ${after.real}`
}

function sameFile(a: FileSeen, b: FileSeen): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
