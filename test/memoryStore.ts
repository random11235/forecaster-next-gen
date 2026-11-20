import type { KeyValueStore } from '../src/storage/webStorage.js'

// Browser storage as `localStorage` keeps it, for the tests of the web build's storage (the Storage contract's, and
// Seam B's run on both storages).

/** Browser storage as `localStorage` keeps it: strings by key, in `items`, refusing a save past `quota` characters in all. */
export function memoryStore(quota = Infinity): KeyValueStore & { items: Map<string, string> } {
  const items = new Map<string, string>()
  const size = (without: string) => [...items].reduce((sum, [key, value]) => sum + (key === without ? 0 : key.length + value.length), 0)
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem(key, value) {
      if (size(key) + key.length + value.length > quota) throw new Error('QuotaExceededError')
      items.set(key, value)
    },
  }
}
