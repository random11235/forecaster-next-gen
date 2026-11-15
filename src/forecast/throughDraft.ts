import type { SetupDraft } from '../model/setupDraft.js'
import type { MilestoneQueryStorage, SavedReadStorage, SetupStorage } from '../storage/storage.js'

/** What a draft is held over: the saved queries and reads, and where setup keeps the draft. */
export type DraftedThrough = { milestoneQueries: MilestoneQueryStorage; reads: SavedReadStorage; setup: SetupStorage }

/** A draft with nothing chosen yet: the steps show the saved queries and reads. */
const NO_DRAFT: SetupDraft = { reads: [] }

/** The queries a draft is held over, as `throughDraft` gives them, so a draft is never held over another. */
const drafted = new WeakSet<MilestoneQueryStorage>()

/**
 * What the setup steps read and save with: `connecting` with its queries and their reads held in the team's setup
 * draft while setup is open. Each step's picks, hand-written queries and reads are saved into the draft, and read from
 * it before the saved ones, so the steps show them while the forecast and the Inputs values keep the saved ones until
 * "Use these" (`applyDraft`). A read made in setup is the query's latest there, and the saved one, if any, the read
 * before it. Setup closed, it is `connecting` as it is; held over a draft already, too. Each Seam B entry point of the
 * steps reads through it, so its callers never do.
 */
export function throughDraft<T extends DraftedThrough>(connecting: T): T {
  if (drafted.has(connecting.milestoneQueries)) return connecting
  const { milestoneQueries: saved, reads: savedReads, setup } = connecting
  const draftOf = (teamId: string): SetupDraft | undefined => (setup.setupState(teamId).open ? setup.setupDraft(teamId) : undefined)
  const redraft = (teamId: string, change: (draft: SetupDraft) => SetupDraft): boolean => {
    if (!setup.setupState(teamId).open) return false
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
  drafted.add(milestoneQueries)
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

/** The team's setup draft with `change` made to it, saved: a new one if it had none. */
export function redrafted(setup: SetupStorage, teamId: string, change: (draft: SetupDraft) => SetupDraft): void {
  setup.saveSetupDraft(teamId, change(setup.setupDraft(teamId) ?? NO_DRAFT))
}

/**
 * Saves the draft's queries and reads over the saved ones, and why its picks' reads failed over why theirs did, a pick
 * read well in it failing no longer; then discards it.
 */
export function applyDraft({ milestoneQueries, reads, setup }: DraftedThrough, teamId: string): void {
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
