const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n
const MASK_64 = 0xffffffffffffffffn

/** A stable 64-bit FNV-1a hash of a JSON value, independent of object key order. */
export function hashJson(value: unknown): string {
  let hash = FNV_OFFSET
  for (const char of canonicalJson(value)) {
    const codePoint = char.codePointAt(0)
    if (codePoint === undefined) throw new Error('A character from a string’s iterator has no code point.')
    hash ^= BigInt(codePoint)
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash.toString(16).padStart(16, '0')
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}
