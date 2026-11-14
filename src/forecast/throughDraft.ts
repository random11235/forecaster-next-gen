import type { SetupDraft } from '../model/setupDraft.js'
import type { MilestoneQueryStorage, SavedReadStorage, SetupStorage } from '../storage/storage.js'

/** What a draft is held over: the saved queries and reads, and where setup keeps the draft. */
export type DraftedThrough = { milestoneQueries: MilestoneQueryStorage; reads: SavedReadStorage; setup: SetupStorage }

/** A draft with nothing chosen yet: the steps show the saved queries and reads. */
export const NO_DRAFT: SetupDraft = { reads: [] }

/** Whether setup's steps are open: in a first setup, or opened again from its summary with Change. */
export function isOpen(setup: SetupStorage, teamId: string): boolean {
  const closed = setup.setupClosed(teamId)
  return closed === undefined || isReopened(setup, teamId)
}

/** Whether setup's steps were opened again from its summary with Change: done, with a draft. */
export function isReopened(setup: SetupStorage, teamId: string): boolean {
  return setup.setupClosed(teamId) === 'done' && setup.setupDraft(teamId) !== undefined
}

/**
 * Seam B: what the setup steps read and save with, `connecting` with its queries and their reads held in the team's
 * setup draft while setup is open: each step's picks, hand-written queries and reads are saved into the draft, and
 * read from it before the saved ones, so the steps show them while the forecast and the Inputs values keep the saved
 * ones until "Use these" (`submitSetup`). A read made in setup is the query's latest there, and the saved one, if any,
 * the read before it. Setup closed, it is `connecting` as it is.
 */
export function throughDraft<T extends DraftedThrough>(connecting: T): T {
  const { milestoneQueries: saved, reads: savedReads, setup } = connecting
  const draftOf = (teamId: string): SetupDraft | undefined => (isOpen(setup, teamId) ? setup.setupDraft(teamId) : undefined)
  const redraft = (teamId: string, change: (draft: SetupDraft) => SetupDraft): boolean => {
    if (!isOpen(setup, teamId)) return false
    setup.saveSetupDraft(teamId, change(setup.setupDraft(teamId) ?? NO_DRAFT))
    return true
  }
  const draftRead = ({ teamId, query }: { teamId: string; query: string }) => draftOf(teamId)?.reads.find((each) => each.query === query)?.read
  const milestoneQueries: MilestoneQueryStorage = {
    milestoneQuery: (teamId) => draftOf(teamId)?.milestoneQuery ?? saved.milestoneQuery(teamId),
    comparableWorkQuery: (teamId) => draftOf(teamId)?.comparableWorkQuery ?? saved.comparableWorkQuery(teamId),
    saveMilestoneQuery: (teamId, milestoneQuery) => {
      if (!redraft(teamId, (draft) => ({ ...draft, milestoneQuery }))) saved.saveMilestoneQuery(teamId, milestoneQuery)
    },
    saveComparableWorkQuery: (teamId, comparableWorkQuery) => {
      if (!redraft(teamId, (draft) => ({ ...draft, comparableWorkQuery }))) saved.saveComparableWorkQuery(teamId, comparableWorkQuery)
    },
  }
  const reads: SavedReadStorage = {
    savedRead: (teamQuery) => draftRead(teamQuery) ?? savedReads.savedRead(teamQuery),
    previousRead: (teamQuery) => (draftRead(teamQuery) ? savedReads.savedRead(teamQuery) : savedReads.previousRead(teamQuery)),
    saveRead: (teamQuery, read) => {
      const kept = redraft(teamQuery.teamId, (draft) => ({ ...draft, reads: [...draft.reads.filter((each) => each.query !== teamQuery.query), { query: teamQuery.query, read }] }))
      if (!kept) savedReads.saveRead(teamQuery, read)
    },
  }
  return { ...connecting, milestoneQueries, reads }
}

/** Saves the draft's queries and reads over the saved ones, and discards it. */
export function applyDraft({ milestoneQueries, reads, setup }: DraftedThrough, teamId: string): void {
  const draft = setup.setupDraft(teamId)
  if (!draft) return
  if (draft.milestoneQuery) milestoneQueries.saveMilestoneQuery(teamId, draft.milestoneQuery)
  if (draft.comparableWorkQuery) milestoneQueries.saveComparableWorkQuery(teamId, draft.comparableWorkQuery)
  for (const { query, read } of draft.reads) reads.saveRead({ teamId, query }, read)
  setup.discardSetupDraft(teamId)
}
