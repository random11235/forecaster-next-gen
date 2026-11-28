import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

/** The modules `entry` imports, transitively: factory files it imports by path, and the packages any of them import. */
function importsOf(entry: string): { scripts: Set<string>; packages: Set<string> } {
  const scripts = new Set<string>()
  const packages = new Set<string>()
  const visit = (path: string) => {
    if (scripts.has(path)) return
    scripts.add(path)
    const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
    for (const { groups } of source.matchAll(/^(?:import|export)[^'"]*?from '(?<from>[^']+)'/gm)) {
      const from = groups?.from ?? ''
      if (from.startsWith('./')) visit(`factory/${from.slice(2)}`)
      else packages.add(from)
    }
  }
  visit(entry)
  return { scripts, packages }
}

// factory.yml's `ask` decides before it installs anything, so a comment that asks nothing costs no `npm ci`
test('the decision whether a comment asks the factory a question imports no package, only Node', () => {
  const { scripts, packages } = importsOf('factory/factoryAsked.ts')

  expect(scripts).toContain('factory/factoryQuestion.ts')
  expect([...packages].filter((name) => !name.startsWith('node:'))).toEqual([])
})
