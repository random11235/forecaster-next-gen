import type { Choice, Ticket } from '../src/connectors/connector.js'
import type { ConnectionStorage, MilestoneQueryStorage, SavedReadStorage, SetupStorage, Storage, TeamQueryStorage } from '../src/storage/storage.js'

// A team on a tracker, as the tests of what the tracker reads (#211–#215) arrange it: the team, today, the milestone
// the tracker lists, and the tickets it answers with. forecast/'s tests open the team's handle on them through
// test/forecast/forecastingForTest.ts; app/'s through test/app/appOnTracker.ts.

/** What the local server build stores, by the interfaces its tests use. */
export type TeamStorage = Storage & ConnectionStorage & SavedReadStorage & MilestoneQueryStorage & SetupStorage & TeamQueryStorage

export const TEAM = 'team'
/** A Thursday. */
export const TODAY = '2026-11-12'

export const CHECKOUT: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

/** The label `name`, as a choice of the tracker's. */
export const label = (name: string): Choice => ({ kind: 'label', name, query: `label:"${name}"` })

/** The ISO calendar date the day after `day`. */
export const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** `count` open tickets, with ids from `prefix`. */
export const open = (count: number, prefix = 'o'): Ticket[] => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}` }))

/** `count` tickets finished at 10:00 UTC on `day`, with ids from `prefix`. */
export const finishedOn = (prefix: string, day: string, count: number): Ticket[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${day}-${i}`, finishedAt: `${day}T10:00:00Z` }))

/** Tickets finished `counts[i]` in the week starting on `weeks[i]` (a Monday), on its Tuesday. */
export const finishedInWeeks = (weeks: readonly string[], counts: readonly number[], prefix = 'w'): Ticket[] =>
  counts.flatMap((count, week) => finishedOn(prefix, addDay(weeks[week]!), count))
