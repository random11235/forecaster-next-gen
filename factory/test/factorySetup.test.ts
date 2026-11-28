import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const DIR = new URL('../../.github/workflows/', import.meta.url)

// The factory installs Node and runs npm ci itself, so a change to CI's shared setup can't change what the factory runs
test("no factory workflow uses CI's setup action", () => {
  const factory = readdirSync(DIR).filter((name) => name.startsWith('factory'))
  const using = factory.filter((name) => /uses:\s*\.\/\.github\/actions\/setup\b/.test(readFileSync(new URL(name, DIR), 'utf8')))

  expect(factory).toContain('factory.yml')
  expect(using).toEqual([])
})
