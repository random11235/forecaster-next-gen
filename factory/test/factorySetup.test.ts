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

// GitHub shares no env between workflows, so the smoke test repeats the factory's Node and install, which it sets up as
// the build does
test('the smoke test installs the Node and runs the install command the config sets', () => {
  const env = workflowEnv()
  const smoke = readFileSync(new URL('factory-smoke.yml', DIR), 'utf8')

  expect(workflowEnv('factory-smoke.yml')).toEqual({ NODE_MAJOR: env.NODE_MAJOR, INSTALL_COMMAND: env.INSTALL_COMMAND })
  expect(smoke).toContain('node-version: ${{ env.NODE_MAJOR }}')
  expect(smoke).toContain('run: $INSTALL_COMMAND')
})

// The comments, park reasons and step names name a label through its config: only a job's `if` and the concurrency
// group, which can't read env, repeat one, as the test above pins
test('factory.yml names a label outside its config only where it cannot read the config', () => {
  const env = workflowEnv()
  const code = readFileSync(new URL('factory.yml', DIR), 'utf8')
    .split('\n')
    .filter((line) => !/^\s*#/.test(line) && !/^ {2}[A-Z_]+_LABEL: /.test(line))
    .map((line) =>
      line
        .replace(/ # [^$`'"]*$/, '')
        .replace(/github\.event\.label\.name == '[^']*'/g, '')
        .replace(/cancel-in-progress/g, ''),
    )
  const named = [env.TRIGGER_LABEL, env.IN_PROGRESS_LABEL, `\`${env.PARKED_LABEL}\``, `'${env.PARKED_LABEL}'`, `"${env.PARKED_LABEL}"`]

  expect(code.filter((line) => named.some((label) => line.includes(label ?? '')))).toEqual([])
})
