import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { jiraConnector } from '../../../src/connectors/jira.js'
import { json, mustNotWait } from '../backoff.js'
import { CONNECTION, SINCE } from './jiraStandIn.js'

/** A ticket in a stand-in Jira's hierarchy: its key, id and hierarchy level, and its parent's key. */
interface Nested {
  key: string
  id: string
  level: number
  parent?: string
}

/**
 * A stand-in Jira holding the open tickets `tickets`, searched as Jira does: by key, and by `parent`, naming each parent
 * by its key or its id. `searched` keeps each search's JQL.
 */
function nested(tickets: Nested[]) {
  const searched: string[] = []
  const found = (ticket: Nested) => ({
    id: ticket.id,
    key: ticket.key,
    fields: {
      issuetype: { hierarchyLevel: ticket.level },
      status: { statusCategory: { key: 'new' } },
      subtasks: [],
      parent: { id: tickets.find(({ key }) => key === ticket.parent)?.id },
    },
  })
  const named = (list: string) => list.split(',').map((each) => each.trim())
  const transport: Transport = async (url, init) => {
    if (url.endsWith('/_edge/tenant_info')) return json(200, { cloudId: 'cloud-1' })
    if (url.endsWith('/project/SYN')) return json(200, {})
    const { jql } = JSON.parse(String(init?.body)) as { jql: string }
    searched.push(jql)
    if (jql.includes('subTaskIssueTypes()')) return json(200, { issues: [], isLast: true })
    const keys = /\bkey in \(([^)]*)\)/.exec(jql)?.[1]
    const parents = [...jql.matchAll(/\bparent (?:= ([\w-]+)|in \(([^)]*)\))/g)].flatMap((match) => named(match[1] ?? match[2]!))
    const matching = keys
      ? tickets.filter(({ key }) => named(keys).includes(key))
      : tickets.filter(({ parent }) => tickets.some(({ key, id }) => key === parent && (parents.includes(key) || parents.includes(id))))
    return json(200, { issues: matching.map(found), isLast: true })
  }
  return { transport, searched }
}

describe('A picked epic on Jira', () => {
  test('in a hierarchy above epics, picks up on a later read an epic added beneath the picked one since the last', async () => {
    const tickets: Nested[] = [
      { key: 'SYN-1', id: '1', level: 2 },
      { key: 'SYN-2', id: '2', level: 1, parent: 'SYN-1' },
      { key: 'SYN-3', id: '3', level: 0, parent: 'SYN-2' },
    ]
    const connector = jiraConnector(CONNECTION, 'token', nested(tickets).transport, mustNotWait)

    expect(await connector.read('parent = SYN-1', SINCE)).toEqual({ ok: true, tickets: [{ id: '3' }], incomplete: false })

    tickets.push({ key: 'SYN-4', id: '4', level: 1, parent: 'SYN-1' }, { key: 'SYN-5', id: '5', level: 0, parent: 'SYN-4' })

    expect(await connector.read('parent = SYN-1', SINCE)).toEqual({ ok: true, tickets: [{ id: '3' }, { id: '5' }], incomplete: false })
  })

  test('reads each picked epic in its place in the query as itself or the epics beneath it, leaving the rest as written', async () => {
    const jira = nested([
      { key: 'SYN-1', id: '1', level: 2 },
      { key: 'SYN-2', id: '2', level: 1, parent: 'SYN-1' },
      { key: 'SYN-9', id: '9', level: 1 },
    ])
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    await connector.read('(parent = SYN-1 AND labels = "parent = SYN-1") OR NOT parent = SYN-1 OR parent = SYN-9', SINCE)

    expect(jira.searched.slice(0, 3)).toEqual([
      'project = "SYN" AND key in (SYN-1, SYN-9)',
      'project = "SYN" AND parent in (1)',
      'project = "SYN" AND ((parent in (SYN-1, 2) AND labels = "parent = SYN-1") OR NOT parent = SYN-1 OR parent = SYN-9) AND (statusCategory != Done OR status CHANGED AFTER "2025-12-31 00:00" OR created >= "2025-12-31 00:00")',
    ])
  })

  test('picked as its choice reads it, an epic has only stories beneath it, so it is looked up and no level beneath it is', async () => {
    const jira = nested([
      { key: 'SYN-106', id: '106', level: 1 },
      { key: 'SYN-108', id: '108', level: 0, parent: 'SYN-106' },
    ])
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    expect(await connector.read('parent = SYN-106', SINCE)).toEqual({ ok: true, tickets: [{ id: '108' }], incomplete: false })
    expect(jira.searched.filter((jql) => jql.includes(' parent in ('))).toEqual([])
  })

  test('a query naming no epic is read with no search for what is beneath one', async () => {
    const jira = nested([])
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    await connector.read('labels = checkout', SINCE)

    expect(jira.searched.filter((jql) => jql.includes('key in (') || jql.includes('parent in ('))).toEqual([])
  })
})
