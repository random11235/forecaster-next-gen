import type { PaceAction, PaceWindow, SeenReads } from '../../model/milestoneInputs.js'

/*
 * Stored JSON, read back: the one place in storage that calls `JSON.parse` (test/storedJsonRules.test.ts checks it).
 * Each value is checked for the shape storage reads it as, so a blob a later version, or a damaged file, left in a
 * shape this version doesn't know is refused, never read as something it isn't (CODING_STANDARDS.md, One-way doors).
 */

/** Whether a parsed value is the shape storage reads it as. */
export type ShapeCheck<T> = (value: unknown) => value is T

/**
 * The JSON `text` stored in `column` (`table.column`, or wherever it is kept), parsed and checked by `check`. Throws,
 * naming the column, on text that isn't JSON or on a shape `check` doesn't recognise.
 */
export function parseStored<T>(text: string, column: string, check: ShapeCheck<T>): T {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${column} holds text that isn't JSON, which this version of the Forecaster can't read.`)
  }
  if (!check(value)) throw new Error(`${column} holds JSON of a shape this version of the Forecaster can't read.`)
  return value
}

/** A JSON object, not a list or null. */
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** A JSON string. */
export const isString = (value: unknown): value is string => typeof value === 'string'

/** A list whose every item passes `item`. */
export const isListOf =
  <T>(item: ShapeCheck<T>): ShapeCheck<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.every(item)

/** A field JSON may drop: missing (undefined), or passing `check`. */
const optional =
  <T>(check: ShapeCheck<T>): ShapeCheck<T | undefined> =>
  (value): value is T | undefined =>
    value === undefined || check(value)

/** The pace counts: a list of numbers. */
export const isPaceCounts = isListOf((value): value is number => typeof value === 'number' && Number.isFinite(value))

/** A pick as stored: its kind (one this version may not know), name and query. */
export const isStoredPick = (value: unknown): value is { kind: string; name: string; query: string } =>
  isObject(value) && isString(value.kind) && isString(value.name) && isString(value.query)

/** The picks as stored, in order. */
export const isStoredPicks = isListOf(isStoredPick)

const isPaceAction = (value: unknown): value is PaceAction =>
  isObject(value) && ((value.kind === 'startFrom' && isString(value.date)) || (value.kind === 'leaveOut' && isString(value.period)))

/** The pace window as stored: a file from before #161 has no action, and one from before #210 no skipped periods. */
export const isStoredPaceWindow = (value: unknown): value is Partial<PaceWindow> =>
  isObject(value) && optional(isPaceAction)(value.action) && optional(isListOf(isString))(value.skippedPeriods)

/** The reads seen as stored: JSON drops an undefined `readAt`, and a file from before #210 has seen none. */
export const isStoredSeenReads = (value: unknown): value is Partial<SeenReads> =>
  isObject(value) && optional(isString)(value.ticketsRemaining) && optional(isString)(value.pace)
