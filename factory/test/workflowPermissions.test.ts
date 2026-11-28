import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const DIR = new URL('../../.github/workflows/', import.meta.url)
const WORKFLOWS = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name))

/**
 * One `permissions:` of a workflow: its indent (0 for the workflow's own) and its grants, `scope: access`, `read-all` or
 * `write-all`, or the raw text of one this test can't read.
 */
type Permissions = { indent: number; at: number; grants: string[] }

/**
 * Every `permissions:` in a workflow, read with its comments stripped, written as a block, a one-line flow map or one
 * word. Anything else (an anchor, an alias, a flow map over lines) comes back as a grant of its raw text.
 */
const permissionsIn = (name: string): Permissions[] => {
  const lines = readFileSync(new URL(name, DIR), 'utf8')
    .split('\n')
    .map((line) => line.replace(/(^|\s)#.*$/, '').trimEnd())
  const unquote = (text: string) => text.trim().replace(/^(['"])(.*)\1$/, '$2')
  const grant = (entry: string) => {
    const [scope, access, ...rest] = entry.split(':').map(unquote)
    return access === undefined || rest.length ? entry.trim() : `${scope}: ${access}`
  }
  return lines.flatMap((line, at) => {
    const key = /^( *)['"]?permissions['"]?\s*:\s*(.*)$/.exec(line)
    if (!key) return []
    const indent = key[1]!.length
    const inline = key[2]!.trim()
    if (inline) {
      const map = /^\{(.*)\}$/.exec(inline)
      const entries = map ? map[1]!.split(',').filter((entry) => entry.trim()) : [inline]
      return [{ indent, at, grants: entries.map(grant) }]
    }
    const end = lines.findIndex((each, i) => i > at && each.trim() !== '' && each.search(/\S/) <= indent)
    const block = lines.slice(at + 1, end === -1 ? undefined : end).filter((each) => each.trim())
    return [{ indent, at, grants: block.map(grant) }]
  })
}

/** A grant this test can read: anything else fails it, rather than passing unread. */
const readable = (grant: string) => /^(read-all|write-all|[a-z-]+: (read|write|none))$/.test(grant)

/** Whether a grant lets the token write to any scope. */
const writesAny = (grant: string) => grant === 'write-all' || grant.endsWith(': write')

/** Whether a grant lets the token write to issues. */
const writesIssues = (grant: string) => grant === 'write-all' || grant === 'issues: write'

// isActionsBot (factory/factoryTrust.ts) takes a github-actions comment as the factory's only while no other workflow's
// token may write to issues
test('every workflow caps its own token at read, and only the factory grants a job issues: write', () => {
  for (const name of WORKFLOWS) {
    const all = permissionsIn(name)
    expect([name, all.flatMap(({ grants }) => grants).filter((grant) => !readable(grant))]).toEqual([name, []])
    const own = all.filter(({ indent }) => indent === 0)
    expect([name, own.length]).toEqual([name, 1])
    expect([name, own[0]!.grants.filter(writesAny)]).toEqual([name, []])
  }
  const granting = WORKFLOWS.filter((name) => permissionsIn(name).some(({ grants }) => grants.some(writesIssues)))
  expect(granting).toEqual(['factory.yml'])
})

/** The grants of a job's own `permissions:` in factory.yml, sorted, or undefined if it sets none. */
const factoryJob = (job: string): string[] | undefined => {
  const lines = readFileSync(new URL('factory.yml', DIR), 'utf8').split('\n')
  const start = lines.findIndex((line) => line.replace(/\s#.*$/, '') === `  ${job}:`)
  const next = lines.findIndex((line, at) => at > start && /^ {2}[a-z-]+:/.test(line))
  const end = next === -1 ? lines.length : next
  return permissionsIn('factory.yml')
    .find(({ indent, at }) => indent === 4 && at > start && at < end)
    ?.grants.slice()
    .sort()
}

// The jobs that run on a spec's PR, which a merged PR's event starts with write access, run only the default branch's
// code: their grants are pinned, so widening one is a change to review here
test("the jobs that open and close a spec's PR to the default branch hold only the grants they need", () => {
  expect(factoryJob('propose')).toEqual(['contents: read', 'issues: read', 'pull-requests: read'])
  expect(factoryJob('close')).toEqual(['actions: write', 'contents: write', 'issues: write'])
})
