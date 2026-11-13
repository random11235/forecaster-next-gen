import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { jiraConnector } from '../../../src/connectors/jira/jiraConnector.js'
import { recordJira } from '../../../scripts/record.js'

// The recording script's Jira logic, on a stand-in Jira: what it keeps of each response, and what it says when the
// recording token is refused. The live run is `npm run record:jira`.

const EMAIL = 'recorder@example.com'
const TOKEN = 'ATATT-recording-token-under-test'
const CLOUD = 'cloud-under-test'

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-arequestid': 'abc' } })
}

/** A stand-in Jira that accepts only EMAIL:TOKEN, knows only the space SYN, and answers with more fields than are read. */
const jira: Transport = async (url, init) => {
  if (url === 'https://ralphhockley.atlassian.net/_edge/tenant_info') return json(200, { cloudId: CLOUD })
  if (new Headers(init?.headers).get('authorization') !== `Basic ${btoa(`${EMAIL}:${TOKEN}`)}`) {
    return new Response('Client must be authenticated to access this resource.', { status: 401 })
  }
  const unknown = json(404, { errorMessages: ["No project could be found with key 'SYNUNKNOWN'."], errors: {} })
  if (url.endsWith('/project/SYN')) return json(200, { id: '10001', key: 'SYN', name: 'Synthetic', lead: { displayName: 'Someone' } })
  if (url.endsWith('/project/SYN/versions')) {
    return json(200, [{ id: '10001', name: 'Search revamp', released: false, archived: false, description: 'Synthetic', self: 'https://x', projectId: 10001 }])
  }
  if (url.endsWith('/project/SYN/statuses')) {
    const status = (id: string, name: string, key: string) => ({ id, name, description: 'Synthetic', statusCategory: { id: 3, key, name, colorName: 'green' } })
    return json(200, [{ id: '10009', name: 'Story', subtask: false, statuses: [status('10003', 'To Do', 'new'), status('10004', 'Done', 'done')] }])
  }
  if (url.includes('/project/')) return unknown
  if (url.endsWith('/label?maxResults=100')) return json(200, { values: ['comparable', 'ktlo'], isLast: true, maxResults: 100, startAt: 0, total: 2, self: 'https://x' })
  if (url.includes('/jql/autocompletedata/suggestions?fieldName=labels&')) {
    return json(200, { results: [{ value: 'comparable', displayName: '<b>compar</b>able by Someone' }] })
  }
  if (url.endsWith('/changelog/bulkfetch')) {
    return json(200, {
      issueChangeLogs: [
        {
          issueId: '10134',
          changeHistories: [
            {
              id: '10230',
              author: { displayName: 'Someone', timeZone: 'Australia/Melbourne' },
              created: 1794036079480,
              items: [{ field: 'status', fieldtype: 'jira', fieldId: 'status', from: '10003', fromString: 'To Do', to: '10004', toString: 'Done' }],
            },
          ],
        },
      ],
    })
  }
  const { jql } = JSON.parse(String(init?.body)) as { jql: string }
  // Like Jira, search on an unknown project matches nothing rather than failing; a refused query gets a 400.
  if (jql.includes('==')) return json(400, { errorMessages: ["Error in JQL Query: Expecting either a value, list or function but got '='."], errors: {}, warningMessages: [] })
  if (!jql.startsWith('project = "SYN" ') || jql.includes('no-such-label')) return json(200, { issues: [], isLast: true })
  if (jql.includes('issuetype = Epic')) {
    const fields = { summary: 'Payment methods', status: { name: 'In Progress' }, assignee: { displayName: 'Someone' } }
    return json(200, { issues: [{ id: '10105', key: 'SYN-106', self: 'https://x', fields }], isLast: true })
  }
  if (jql.includes(' key in (SYN-106)')) {
    const fields = { issuetype: { id: '10010', name: 'Epic', subtask: false, hierarchyLevel: 1 }, summary: 'Payment methods' }
    return json(200, { issues: [{ id: '10105', key: 'SYN-106', self: 'https://x', fields }], isLast: true })
  }
  if (jql.includes('subTaskIssueTypes()')) {
    const parent = { id: '10133', key: 'SYN-134', fields: { summary: 'Search leaf 1', status: { name: 'In Progress' } } }
    return json(200, { issues: [{ id: '10134', key: 'SYN-135', fields: { parent } }], isLast: true })
  }
  return json(200, {
    issues: [
      {
        id: '10133',
        key: 'SYN-134',
        self: 'https://x',
        expand: 'renderedFields',
        fields: {
          summary: 'Search leaf 1',
          issuetype: { id: '10009', name: 'Story', subtask: false, hierarchyLevel: 0 },
          status: { name: 'In Progress', id: '3', self: 'https://x', statusCategory: { key: 'indeterminate', name: 'In Progress', colorName: 'yellow' } },
          subtasks: [
            {
              id: '10134',
              key: 'SYN-135',
              fields: {
                summary: 'Search subtask',
                status: { name: 'Done', id: '10004', statusCategory: { key: 'done', name: 'Done' } },
                issuetype: { name: 'Subtask', hierarchyLevel: -1 },
              },
            },
          ],
          assignee: { displayName: 'Someone' },
        },
      },
    ],
    isLast: true,
  })
}

describe('the Jira recording script', () => {
  test('keeps only the fields the connector reads, and no headers', async () => {
    const result = await recordJira(EMAIL, TOKEN, jira, jiraConnector)

    if (!result.ok) throw new Error(result.message)
    const responses = result.recordings.synthetic.map((recording) => recording.response.body)
    expect(responses).toContainEqual({ cloudId: CLOUD })
    expect(responses).toContainEqual({ errorMessages: ["Error in JQL Query: Expecting either a value, list or function but got '='."] })
    expect(responses).toContainEqual([{ id: '10001', name: 'Search revamp', released: false, archived: false }])
    expect(responses).toContainEqual({
      issues: [
        {
          id: '10133',
          fields: {
            issuetype: { hierarchyLevel: 0 },
            status: { statusCategory: { key: 'indeterminate' } },
            subtasks: [{ id: '10134', fields: { status: { statusCategory: { key: 'done' } } } }],
          },
        },
      ],
      isLast: true,
    })
    expect(responses).toContainEqual({ issues: [{ id: '10134', fields: { parent: { id: '10133' } } }], isLast: true })
    // An epic is read by its key, so the epics search keeps it.
    expect(responses).toContainEqual({ issues: [{ id: '10105', key: 'SYN-106', fields: { summary: 'Payment methods' } }], isLast: true })
    // A picked epic is looked up by its key, to find what is beneath it, so that search keeps it too.
    expect(responses).toContainEqual({ issues: [{ id: '10105', key: 'SYN-106', fields: { issuetype: { hierarchyLevel: 1 } } }], isLast: true })
    expect(responses).toContainEqual({ values: ['comparable', 'ktlo'], isLast: true })
    expect(responses).toContainEqual({ results: [{ value: 'comparable' }] })
    expect(responses).toContainEqual([
      {
        statuses: [
          { id: '10003', statusCategory: { key: 'new' } },
          { id: '10004', statusCategory: { key: 'done' } },
        ],
      },
    ])
    expect(responses).toContainEqual({
      issueChangeLogs: [{ issueId: '10134', changeHistories: [{ created: 1794036079480, items: [{ fieldId: 'status', from: '10003', to: '10004' }] }] }],
    })
    expect(JSON.stringify(result.recordings)).not.toMatch(/Someone|Synthetic|SYN-13[45]|Melbourne|To Do|x-arequestid|Basic|warningMessages|lead/)
  })

  test('never writes the token or the account email into a recording', async () => {
    const result = await recordJira(EMAIL, TOKEN, jira, jiraConnector)

    const written = JSON.stringify(result)
    expect(written).not.toContain(TOKEN)
    expect(written).not.toContain(EMAIL)
    expect(written).not.toContain(btoa(`${EMAIL}:${TOKEN}`))
  })

  test('records only from the synthetic space', async () => {
    const result = await recordJira(EMAIL, TOKEN, jira, jiraConnector)

    if (!result.ok) throw new Error(result.message)
    const requests = Object.values(result.recordings).flatMap((recordings) => recordings.map((recording) => recording.request))
    expect(requests.length).toBeGreaterThan(0)
    for (const { url, body } of requests) {
      if (url.endsWith('/_edge/tenant_info')) expect(url).toBe('https://ralphhockley.atlassian.net/_edge/tenant_info')
      // Changelogs are fetched by id, only for tickets the space's search found.
      else if (url.endsWith('/changelog/bulkfetch')) expect(JSON.parse(body!)).toMatchObject({ issueIdsOrKeys: ['10134'] })
      // Jira keeps labels for the whole site, not per project.
      else if (url.includes('/label?')) expect(url).toBe(`https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3/label?maxResults=100`)
      else if (url.includes('/suggestions?')) expect(url).toMatch(new RegExp(`^https://api\\.atlassian\\.com/ex/jira/${CLOUD}/rest/api/3/jql/autocompletedata/suggestions\\?fieldName=labels&`))
      else expect(`${url} ${body ?? ''}`).toMatch(new RegExp(`^https://api\\.atlassian\\.com/ex/jira/${CLOUD}/.*SYN`))
    }
  })

  test('records each failure the tracker gives: a refused token and an unknown project', async () => {
    const result = await recordJira(EMAIL, TOKEN, jira, jiraConnector)

    if (!result.ok) throw new Error(result.message)
    // The read is recorded from the start and from the cut: two searches.
    expect(result.recordings.refusedToken.map((recording) => recording.response.status)).toEqual([200, 401, 401, 401])
    expect(result.recordings.unknown.map((recording) => recording.response.status)).toEqual([200, 404, 200, 404, 200])
  })

  test('says plainly when the recording token is refused, and records nothing', async () => {
    const result = await recordJira(EMAIL, 'ATATT-expired', jira, jiraConnector)

    expect(result).toEqual({ ok: false, message: expect.stringContaining('Jira refused the recording token') })
    if (result.ok) return
    expect(result.message).toContain('forecaster-jira-recording')
    expect(result.message).toContain('30 days')
    expect(result.message).not.toContain(EMAIL)
  })
})
