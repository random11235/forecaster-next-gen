import type { PaceAction, PaceWindow, SeenReads } from '../../model/milestoneInputs.js'
import { isListOf, isNumber, isObject, isString, optional } from './storedJson.js'

/*
 * The milestone inputs' parts kept as JSON, checked as both storages read them back: the SQLite file keeps each in a
 * column of its own (teamTables.ts), and browser storage within the milestone inputs (webStorage.ts).
 */

/** The pace counts: a list of numbers. */
export const isPaceCounts = isListOf(isNumber)

const isPaceAction = (value: unknown): value is PaceAction =>
  isObject(value) && ((value.kind === 'startFrom' && isString(value.date)) || (value.kind === 'leaveOut' && isString(value.period)))

/** The pace window as stored: a file from before #161 has no action, and one from before #210 no skipped periods. */
export const isStoredPaceWindow = (value: unknown): value is Partial<PaceWindow> =>
  isObject(value) && optional(isPaceAction)(value.action) && optional(isListOf(isString))(value.skippedPeriods)

/** The reads seen as stored: JSON drops an undefined `readAt`, and a file from before #210 has seen none. */
export const isStoredSeenReads = (value: unknown): value is Partial<SeenReads> =>
  isObject(value) && optional(isString)(value.ticketsRemaining) && optional(isString)(value.pace)
