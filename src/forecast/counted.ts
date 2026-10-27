/** A count with its words, singular for 1: "1 finished epic", "7 finished epics", "6 are left". */
export function counted(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}
