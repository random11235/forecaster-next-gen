/**
 * What `pattern` finds first in `html`: the whole match, or its `group`th group. A test that reads a part of the page
 * fails here, saying what it looked for, when the page has no such part.
 */
export function found(html: string, pattern: RegExp, group = 0): string {
  const part = html.match(pattern)?.[group]
  if (part === undefined) throw new Error(`Nothing on the page matches ${pattern}`)
  return part
}
