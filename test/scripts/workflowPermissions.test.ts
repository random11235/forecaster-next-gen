import { readdirSync, readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const DIR = new URL('../../.github/workflows/', import.meta.url)
const WORKFLOWS = readdirSync(DIR).filter((name) => /\.ya?ml$/.test(name))

/** One `permissions:` of a workflow: its indent (0 for the workflow's own) and its grants, `scope: access` or `write-all`. */
type Permissions = { indent: number; grants: string[] }

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
      return [{ indent, grants: entries.map(grant) }]
    }
    const end = lines.findIndex((each, i) => i > at && each.trim() !== '' && each.search(/\S/) <= indent)
    const block = lines.slice(at + 1, end === -1 ? undefined : end).filter((each) => each.trim())
    return [{ indent, grants: block.map(grant) }]
  })
}

/** A grant this test can read: anything else fails it, rather than passing unread. */
const readable = (grant: string) => /^(read-all|write-all|[a-z-]+: (read|write|none))$/.test(grant)

/** Whether a grant lets the token write: to the scope named, or to any. */
const writes = (grant: string, scope?: string) => grant === 'write-all' || (scope ? grant === `${scope}: write` : grant.endsWith(': write'))

// isActionsBot (scripts/factoryTrust.ts) takes a github-actions comment as the factory's only while no other workflow's
// token may write to issues
test('every workflow caps its own token at read, and only the factory grants a job issues: write', () => {
  for (const name of WORKFLOWS) {
    const all = permissionsIn(name)
    expect([name, all.flatMap(({ grants }) => grants).filter((grant) => !readable(grant))]).toEqual([name, []])
    const own = all.filter(({ indent }) => indent === 0)
    expect([name, own.length]).toEqual([name, 1])
    expect([name, own[0]!.grants.filter((grant) => writes(grant))]).toEqual([name, []])
  }
  const granting = WORKFLOWS.filter((name) => permissionsIn(name).some(({ grants }) => grants.some((grant) => writes(grant, 'issues'))))
  expect(granting).toEqual(['factory.yml'])
})
