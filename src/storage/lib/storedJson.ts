/*
 * Stored JSON, read back: the one place in storage that parses JSON (test/storedJsonRules.test.ts checks that nothing
 * else uses the `JSON` global but to stringify). Each value is checked for the shape storage reads it as, by a check
 * its reader builds from the ones here, so a blob a later version, or a damaged file, left in a shape this version
 * doesn't know is refused, never read as something it isn't (CODING_STANDARDS.md, One-way doors).
 */

/** Whether a parsed value is the shape storage reads it as. */
type ShapeCheck<T> = (value: unknown) => value is T

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

/** A JSON number. */
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** One of `known`. */
export const isOneOf =
  <T>(known: readonly T[]): ShapeCheck<T> =>
  (value): value is T =>
    known.some((each) => each === value)

/** A list whose every item passes `item`. */
export const isListOf =
  <T>(item: ShapeCheck<T>): ShapeCheck<T[]> =>
  (value): value is T[] =>
    Array.isArray(value) && value.every(item)

/** An object whose every value passes `each`, as records by ID are kept. */
export const isRecordOf =
  <T>(each: ShapeCheck<T>): ShapeCheck<Record<string, T>> =>
  (value): value is Record<string, T> =>
    isObject(value) && Object.values(value).every(each)

/** A field JSON may drop: missing (undefined), or passing `check`. */
export const optional =
  <T>(check: ShapeCheck<T>): ShapeCheck<T | undefined> =>
  (value): value is T | undefined =>
    value === undefined || check(value)
