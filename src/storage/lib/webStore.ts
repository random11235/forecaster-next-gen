import { parseStored, type ShapeCheck } from './storedJson.js'

/*
 * The browser's storage, behind webStorage.ts and webLedger.ts: a JSON value by key, read once as the storage opens
 * and written back whole on each save.
 */

/** The part of the browser's `localStorage` this uses: strings by key. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** A key's value as read: what it holds, or the refusal of a value this version can't read. */
export type Kept<T> = { value: T } | { refused: unknown }

/**
 * What `store` holds under `key`, checked by `check` and laid over `empty`: `empty` when it holds nothing or the browser
 * refuses it, and the refusal, naming the key, when it holds text that isn't JSON or JSON of a shape `check` doesn't
 * recognise.
 */
export function readKey<T extends object>(store: KeyValueStore | undefined, key: string, empty: T, check: ShapeCheck<Partial<T>>): Kept<T> {
  let json: string | null | undefined
  try {
    json = store?.getItem(key)
  } catch {
    return { value: empty }
  }
  if (json === null || json === undefined) return { value: empty }
  try {
    return { value: { ...empty, ...parseStored(json, `browser storage's "${key}"`, check) } }
  } catch (refused) {
    return { refused }
  }
}

/** The value `kept` holds, or throws its refusal. */
export function held<T>(kept: Kept<T>): T {
  if ('refused' in kept) throw kept.refused
  return kept.value
}

/** Writes `json` to `store` under `key`; when the browser gives no storage or refuses it, it is kept in memory only, until the page closes. */
export function writeKey(store: KeyValueStore | undefined, key: string, json: string): void {
  try {
    store?.setItem(key, json)
  } catch {
    // kept in memory only, until the page closes
  }
}
