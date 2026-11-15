import type { MilestoneQuery } from '../../model/milestoneQuery.js'
import type { SavedRead, TeamQuery } from '../../model/savedRead.js'
import type { SetupDraft } from '../../model/setupDraft.js'
import type { MilestoneQueryStorage, QueryTarget, SavedReadStorage, SetupStorage, TeamQueries } from '../storage.js'

/** What the setup draft is held over: the saved queries and reads, and where setup keeps the draft. */
export type Drafted = TeamQueries & { setup: Omit<SetupStorage, 'applySetupDraft'> }

/** A draft with nothing chosen yet: the steps show the saved queries and reads. */
const NO_DRAFT: SetupDraft = { reads: [] }

/** The team's queries and reads in `target`, the setup draft held over what's saved as `QueryTarget` says. */
export function draftedQueries(drafted: Drafted, target: QueryTarget): TeamQueries {
  if (target === 'current') return current(drafted)
  if (target === 'everywhere') return everywhere(drafted)
  return { milestoneQueries: drafted.milestoneQueries, reads: drafted.reads }
}

/** The team's setup draft while setup is open; none while it's closed. */
function draftOf({ setup }: Drafted, teamId: string): SetupDraft | undefined {
  return setup.setupState(teamId).open ? setup.setupDraft(teamId) : undefined
}

/** The draft's read of the query, while setup is open. */
function draftRead(drafted: Drafted, { teamId, query }: TeamQuery): SavedRead | undefined {
  return draftOf(drafted, teamId)?.reads.find((each) => each.query === query)?.read
}

/** The draft with `read` as the query's, replacing any it had. */
function withRead(draft: SetupDraft, query: string, read: SavedRead): SetupDraft {
  return { ...draft, reads: [...draft.reads.filter((each) => each.query !== query), { query, read }] }
}

/**
 * The draft over what's saved while setup is open: each query and read the draft's, else the saved one; a read made in
 * setup the query's latest, the saved one, if any, the read before it. Saves go into the draft, a new one if there is
 * none. Setup closed, it is what's saved.
 */
function current(drafted: Drafted): TeamQueries {
  const { milestoneQueries: saved, reads: savedReads, setup } = drafted
  const redraft = (teamId: string, change: (draft: SetupDraft) => SetupDraft): boolean => {
    if (!setup.setupState(teamId).open) return false
    setup.saveSetupDraft(teamId, change(setup.setupDraft(teamId) ?? NO_DRAFT))
    return true
  }
  const milestoneQueries: MilestoneQueryStorage = {
    milestoneQuery: (teamId) => draftOf(drafted, teamId)?.milestoneQuery ?? saved.milestoneQuery(teamId),
    comparableWorkQuery: (teamId) => draftOf(drafted, teamId)?.comparableWorkQuery ?? saved.comparableWorkQuery(teamId),
    saveMilestoneQuery: (teamId, milestoneQuery) => {
      if (!redraft(teamId, (draft) => ({ ...draft, milestoneQuery }))) saved.saveMilestoneQuery(teamId, milestoneQuery)
    },
    saveComparableWorkQuery: (teamId, comparableWorkQuery) => {
      if (!redraft(teamId, (draft) => ({ ...draft, comparableWorkQuery }))) saved.saveComparableWorkQuery(teamId, comparableWorkQuery)
    },
  }
  const reads: SavedReadStorage = {
    savedRead: (teamQuery) => draftRead(drafted, teamQuery) ?? savedReads.savedRead(teamQuery),
    previousRead: (teamQuery) => (draftRead(drafted, teamQuery) ? savedReads.savedRead(teamQuery) : savedReads.previousRead(teamQuery)),
    saveRead: (teamQuery, read) => {
      if (!redraft(teamQuery.teamId, (draft) => withRead(draft, teamQuery.query, read))) savedReads.saveRead(teamQuery, read)
    },
  }
  return { milestoneQueries, reads }
}

/**
 * What's saved, read and saved; and while setup is open, each save made in the draft too where the draft holds the
 * same as what's saved: the query the saved one is, or a read of the same query. The draft's own choices are kept.
 */
function everywhere(drafted: Drafted): TeamQueries {
  const { milestoneQueries: saved, reads: savedReads, setup } = drafted
  /** Saves `change` into the draft, where its query (`held`) is the saved one (`before`). */
  const follow = (teamId: string, held: (draft: SetupDraft) => MilestoneQuery | undefined, before: MilestoneQuery | undefined, change: (draft: SetupDraft) => SetupDraft): void => {
    const draft = draftOf(drafted, teamId)
    if (draft && before && sameQuery(held(draft), before)) setup.saveSetupDraft(teamId, change(draft))
  }
  const milestoneQueries: MilestoneQueryStorage = {
    milestoneQuery: (teamId) => saved.milestoneQuery(teamId),
    comparableWorkQuery: (teamId) => saved.comparableWorkQuery(teamId),
    saveMilestoneQuery: (teamId, milestoneQuery) => {
      follow(teamId, (draft) => draft.milestoneQuery, saved.milestoneQuery(teamId), (draft) => ({ ...draft, milestoneQuery }))
      saved.saveMilestoneQuery(teamId, milestoneQuery)
    },
    saveComparableWorkQuery: (teamId, comparableWorkQuery) => {
      follow(teamId, (draft) => draft.comparableWorkQuery, saved.comparableWorkQuery(teamId), (draft) => ({ ...draft, comparableWorkQuery }))
      saved.saveComparableWorkQuery(teamId, comparableWorkQuery)
    },
  }
  const reads: SavedReadStorage = {
    savedRead: (teamQuery) => savedReads.savedRead(teamQuery),
    previousRead: (teamQuery) => savedReads.previousRead(teamQuery),
    saveRead: (teamQuery, read) => {
      const draft = draftOf(drafted, teamQuery.teamId)
      if (draft && draftRead(drafted, teamQuery)) setup.saveSetupDraft(teamQuery.teamId, withRead(draft, teamQuery.query, read))
      savedReads.saveRead(teamQuery, read)
    },
  }
  return { milestoneQueries, reads }
}

/** Whether a query is `other`: the same query, of the same picks. */
function sameQuery(one: MilestoneQuery | undefined, other: MilestoneQuery): boolean {
  return one !== undefined && one.query === other.query && JSON.stringify(one.picks) === JSON.stringify(other.picks)
}

/**
 * Applies the team's setup draft ("Use these"), if it has one: its queries and reads saved over the saved ones, and why
 * its picks' reads failed over why theirs did, a pick read well in it failing no longer; then discards it.
 */
export function applySetupDraft({ milestoneQueries, reads, setup }: Drafted, teamId: string): void {
  const draft = setup.setupDraft(teamId)
  if (!draft) return
  if (draft.milestoneQuery) milestoneQueries.saveMilestoneQuery(teamId, draft.milestoneQuery)
  if (draft.comparableWorkQuery) milestoneQueries.saveComparableWorkQuery(teamId, draft.comparableWorkQuery)
  for (const { query, read } of draft.reads) reads.saveRead({ teamId, query }, read)
  const failures = setup.readFailures(teamId) ?? {}
  const readWell = new Set(draft.reads.map(({ query }) => query))
  const picks = { ...Object.fromEntries(Object.entries(failures.picks ?? {}).filter(([query]) => !readWell.has(query))), ...draft.pickFailures }
  setup.saveReadFailures(teamId, { ...failures, picks })
  setup.discardSetupDraft(teamId)
}
