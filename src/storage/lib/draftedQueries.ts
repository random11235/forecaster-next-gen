import type { SavedRead, TeamQuery } from '../../model/savedRead.js'
import type { SetupDraft } from '../../model/setupDraft.js'
import type { MilestoneQueryStorage, QueryTarget, SavedReadStorage, SetupStorage, TeamQueries } from '../storage.js'

/** Where setup keeps the team's draft, and why its reads failed. */
type DraftKeeping = Pick<SetupStorage, 'setupState' | 'setupDraft' | 'saveSetupDraft' | 'discardSetupDraft' | 'readFailures' | 'saveReadFailures'>

/** All storage keeps of the team's queries and reads: what's saved, and where setup keeps the draft held over them. */
export type QueryKeeping = TeamQueries & { setup: DraftKeeping }

/** A draft with nothing chosen yet: the steps show the saved queries and reads. */
const NO_DRAFT: SetupDraft = { reads: [] }

/** The team's queries and reads in `target`, as `QueryTarget` says. */
export function draftedQueries(kept: QueryKeeping, target: QueryTarget): TeamQueries {
  return target === 'current' ? current(kept) : { milestoneQueries: kept.milestoneQueries, reads: kept.reads }
}

/** Saves the team's setup draft with `change` made to it: a new one if it has none. */
function redraft(setup: Pick<SetupStorage, 'setupDraft' | 'saveSetupDraft'>, teamId: string, change: (draft: SetupDraft) => SetupDraft): void {
  setup.saveSetupDraft(teamId, change(setup.setupDraft(teamId) ?? NO_DRAFT))
}

/** Saves the draft's sources (`SetupStorage.saveDraftSources`), the rest of it as it was. */
export function saveDraftSources(setup: Pick<SetupStorage, 'setupDraft' | 'saveSetupDraft'>, teamId: string, sources: SetupDraft['sources']): void {
  redraft(setup, teamId, ({ sources: _, ...draft }) => ({ ...draft, ...(sources && { sources }) }))
}

/** Saves why the draft's picks failed to read (`SetupStorage.saveDraftPickFailures`), the rest of it as it was. */
export function saveDraftPickFailures(setup: Pick<SetupStorage, 'setupDraft' | 'saveSetupDraft'>, teamId: string, pickFailures: SetupDraft['pickFailures']): void {
  redraft(setup, teamId, ({ pickFailures: _, ...draft }) => ({ ...draft, ...(pickFailures && { pickFailures }) }))
}

/**
 * The draft over what's saved while setup is open: each query and read the draft's, else the saved one; a read made in
 * setup the query's latest, the saved one, if any, the read before it. Saves go into the draft, a new one if there is
 * none. Setup closed, it is what's saved.
 */
function current({ milestoneQueries: saved, reads: savedReads, setup }: QueryKeeping): TeamQueries {
  const draftOf = (teamId: string): SetupDraft | undefined => (setup.setupState(teamId).open ? setup.setupDraft(teamId) : undefined)
  const draftRead = ({ teamId, query }: TeamQuery): SavedRead | undefined => draftOf(teamId)?.reads.find((each) => each.query === query)?.read
  /** Saves `change` into the draft while setup is open: whether it did. */
  const intoDraft = (teamId: string, change: (draft: SetupDraft) => SetupDraft): boolean => {
    if (!setup.setupState(teamId).open) return false
    redraft(setup, teamId, change)
    return true
  }
  const milestoneQueries: MilestoneQueryStorage = {
    milestoneQuery: (teamId) => draftOf(teamId)?.milestoneQuery ?? saved.milestoneQuery(teamId),
    comparableWorkQuery: (teamId) => draftOf(teamId)?.comparableWorkQuery ?? saved.comparableWorkQuery(teamId),
    saveMilestoneQuery: (teamId, milestoneQuery) => {
      if (!intoDraft(teamId, (draft) => ({ ...draft, milestoneQuery }))) saved.saveMilestoneQuery(teamId, milestoneQuery)
    },
    saveComparableWorkQuery: (teamId, comparableWorkQuery) => {
      if (!intoDraft(teamId, (draft) => ({ ...draft, comparableWorkQuery }))) saved.saveComparableWorkQuery(teamId, comparableWorkQuery)
    },
  }
  const reads: SavedReadStorage = {
    savedRead: (teamQuery) => draftRead(teamQuery) ?? savedReads.savedRead(teamQuery),
    previousRead: (teamQuery) => (draftRead(teamQuery) ? savedReads.savedRead(teamQuery) : savedReads.previousRead(teamQuery)),
    saveRead: (teamQuery, read) => {
      const { teamId, query } = teamQuery
      if (!intoDraft(teamId, (draft) => ({ ...draft, reads: [...draft.reads.filter((each) => each.query !== query), { query, read }] }))) savedReads.saveRead(teamQuery, read)
    },
  }
  return { milestoneQueries, reads }
}

/**
 * Applies the team's setup draft ("Use these"), if it has one: its queries and reads saved over the saved ones, and why
 * its picks' reads failed over why theirs did, a pick read well in it failing no longer; then discards it.
 */
export function applySetupDraft({ milestoneQueries, reads, setup }: QueryKeeping, teamId: string): void {
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
