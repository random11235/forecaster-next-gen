/**
 * The EM's commit of an epic, made in the tool after kickoff: the epic's child count then is its baseline, the count
 * its growth is measured from. Only the latest commit of an epic is kept. A pull-back is not stored here: whether a
 * commit still stands is derived from the epic's status history on each read (`samples/commits.ts`).
 */
export interface EpicCommit {
  teamId: string
  epicId: string
  /** ISO timestamp. */
  committedAt: string
  /** Children the epic had when committed; cancelled children don't count. Stored as `child_count_at_commit`. */
  baseline: number
}
