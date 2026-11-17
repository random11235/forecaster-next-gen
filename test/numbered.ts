/** `count` things, each made by `make` from its number, counting from 1. */
export function numbered<T>(count: number, make: (n: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i + 1))
}
