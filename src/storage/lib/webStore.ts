import { parseStored, type ShapeCheck } from './storedJson.js'

/*
 * The browser's storage, behind webStorage.ts and webLedger.ts: a JSON value by key, written back whole on each save.
 * webStorage.ts reads its value once, as the storage opens; webLedger.ts reads the ledger again at each call.
 */

/** The part of the browser's `localStorage` this uses: strings by key. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Where browser storage keeps the value under `key`, as a refusal of it names it. */
export const storedAt = (key: string): string => `browser storage's "${key}"`

/** A key's value as read: what it holds, or the refusal of a value this version can't read. */
export type Kept<T> = { value: T } | { refused: unknown }

/**
 * What `store` holds under `key`, checked by `check` and laid over `empty`: `empty` when it holds nothing, `unreadable`
 * (`empty` unless given) when the browser gives no storage or refuses it, and the refusal, naming the key, when it
 * holds text that isn't JSON or JSON of a shape `check` doesn't recognise.
 */
export function readKey<T extends object>(
  store: KeyValueStore | undefined,
  key: string,
  check: ShapeCheck<Partial<T>>,
  { empty, unreadable = empty }: { empty: T; unreadable?: T },
): Kept<T> {
  let json: string | null
  try {
    if (!store) return { value: unreadable }
    json = store.getItem(key)
  } catch {
    return { value: unreadable }
  }
  if (json === null) return { value: empty }
  try {
    return { value: { ...empty, ...parseStored(json, storedAt(key), check) } }
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
