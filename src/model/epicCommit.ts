/**
 * The EM's commit of an epic, made in the tool after kickoff: the epic's child count then is its baseline, the count
 * its growth is measured from. Only the EM's latest commit of an epic is stored. A pull-back is not stored here: whether
 * a commit still stands is derived from the epic's status history on each read (`samples/commits.ts`). It counts the
 * same as a label commit: the commit that stands is the first made since the last pull-back, in the tool or by label.
 */
export interface EpicCommit {
  teamId: string
  epicId: string
  /** ISO timestamp. */
  committedAt: string
  /** Children the epic had when committed; cancelled children don't count. Stored as `child_count_at_commit`. */
  baseline: number
}
