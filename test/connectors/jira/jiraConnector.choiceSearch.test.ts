import { describe, expect, test } from 'vitest'
import { jiraConnector } from '../../../src/connectors/jira.js'
import { json, mustNotWait } from '../backoff.js'
import { numbered } from '../../numbered.js'
import { answeringPastTenant, CONNECTION, jiraListing } from './jiraStandIn.js'

describe('Jira milestone choices searched past the limit', () => {
  test('a fix version, which Jira gives all at once, is found among the unreleased ones, matching part of a word', async () => {
    const versions = numbered(150, (n) => ({ id: String(n), name: `Release ${n}`, released: n === 14, archived: n === 140 }))
    const connector = jiraConnector(CONNECTION, 'token', jiraListing({ versions }).transport, mustNotWait)

    const found = await connector.searchChoices('fixVersion', 'ASE 14')

    expect(found).toEqual({
      ok: true,
      choices: ['Release 141', 'Release 142', 'Release 143', 'Release 144', 'Release 145', 'Release 146', 'Release 147', 'Release 148', 'Release 149'].map(
        (name) => ({ kind: 'fixVersion', name, query: `fixVersion = "${name}"` }),
      ),
    })
  })

  test("an epic is searched by the words of its summary, each a word's start, among the epics not done", async () => {
    const asked: unknown[] = []
    const jira = answeringPastTenant(async (_, init) => {
      asked.push(JSON.parse(String(init?.body)))
      return json(200, { issues: [{ id: '20140', key: 'SYN-140', fields: { summary: 'Card payments' } }], isLast: true })
    })
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    expect(await connector.searchChoices('epic', 'card pay"ments*')).toEqual({
      ok: true,
      choices: [{ kind: 'epic', name: 'Card payments', query: 'parent = SYN-140' }],
    })
    // Search's special characters are left out, so none can make the JQL fail.
    expect(asked).toEqual([
      {
        jql: 'project = "SYN" AND issuetype = Epic AND statusCategory != Done AND summary ~ "card*" AND summary ~ "pay*" AND summary ~ "ments*" ORDER BY created DESC',
        fields: ['summary'],
        maxResults: 100,
      },
    ])
  })

  test("a label is found by JQL's suggestions for the labels field", async () => {
    const jira = answeringPastTenant(async (url) => {
      const { pathname, searchParams } = new URL(url)
      if (pathname.endsWith('/jql/autocompletedata/suggestions') && searchParams.get('fieldName') === 'labels' && searchParams.get('fieldValue') === 'pay') {
        return json(200, {
          results: [
            { value: 'payments', displayName: '<b>pay</b>ments' },
            { value: 'pay"day', displayName: '<b>pay</b>"day' },
          ],
        })
      }
      return json(404, {})
    })
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    expect(await connector.searchChoices('label', 'pay')).toEqual({
      ok: true,
      choices: [
        { kind: 'label', name: 'payments', query: 'labels = "payments"' },
        { kind: 'label', name: 'pay"day', query: 'labels = "pay\\"day"' },
      ],
    })
  })

  test('a search the tracker fails is that failure', async () => {
    const jira = answeringPastTenant(async () => json(502, {}))
    const connector = jiraConnector(CONNECTION, 'token', jira.transport, mustNotWait)

    for (const kind of ['fixVersion', 'epic', 'label'] as const)
      expect(await connector.searchChoices(kind, 'pay')).toEqual({ ok: false, failure: 'unavailable' })
  })
})
