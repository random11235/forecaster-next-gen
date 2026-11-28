import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { workflowEnv } from './workflowConfig.ts'

const DIR = new URL('../../.github/workflows/', import.meta.url)

// The factory installs Node and runs npm ci itself, so a change to CI's shared setup can't change what the factory runs
test("no factory workflow uses CI's setup action", () => {
  const factory = readdirSync(DIR).filter((name) => name.startsWith('factory'))
  const using = factory.filter((name) => /uses:\s*\.\/\.github\/actions\/setup\b/.test(readFileSync(new URL(name, DIR), 'utf8')))

  expect(factory).toContain('factory.yml')
  expect(using).toEqual([])
})

// A job's `if` and `timeout-minutes`, and the concurrency group, can't read the workflow's env, so they repeat its value
test('the values a job sets where it cannot read the config are the config’s', () => {
  const env = workflowEnv()
  const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8')
  const all = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map((match) => match.slice(1))
  const factory = read('factory.yml')

  const timeouts = all(factory, /^ {4}timeout-minutes: (\d+) # ([A-Z_]+)$/gm)
  expect(timeouts.map(([, name]) => name)).toEqual(['JOB_MINUTES', 'CHECK_MINUTES', 'ASK_MINUTES'])
  for (const [minutes, name] of timeouts) expect(minutes).toBe(env[name ?? ''])
  expect(all(factory, /github\.event\.label\.name == '([^']*)'/g).flat()).toEqual(Array(3).fill(env.TRIGGER_LABEL))
  const mentions = [factory, read('factory-relay.yml')].flatMap((text) => all(text, /contains\(github\.event\.comment\.body, '([^']*)'\)/g).flat())
  expect(mentions).toEqual(Array(2).fill(env.MENTION))
})
