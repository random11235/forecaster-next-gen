import type { Storage } from '../../src/storage/storage.js'

/** The storage, counting each time the team's facts are read from it. */
export function countingFactReads(real: Storage): { storage: Storage; reads: () => number } {
  let reads = 0
  const counting = new Proxy(real, {
    get(target, property) {
      if (property === 'facts') {
        return (teamId: string) => {
          reads++
          return target.facts(teamId)
        }
      }
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { storage: counting, reads: () => reads }
}
