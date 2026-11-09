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
  if (url.includes('/project/')) return unknown
  const { jql } = JSON.parse(String(init?.body)) as { jql: string }
  // Like Jira, search on an unknown project matches nothing rather than failing; a refused query gets a 400.
  if (jql.includes('==')) return json(400, { errorMessages: ["Error in JQL Query: Expecting either a value, list or function but got '='."], errors: {}, warningMessages: [] })
  if (!jql.startsWith('project = "SYN" ') || jql.includes('no-such-label')) return json(200, { issues: [], isLast: true })
  return json(200, {
    issues: [
      {
        id: '10133',
        key: 'SYN-134',
        self: 'https://x',
        expand: 'renderedFields',
        fields: {
          summary: 'Search leaf 1',
          status: { name: 'Done', id: '10002', self: 'https://x', statusCategory: { key: 'done', name: 'Done', colorName: 'green' } },
          statuscategorychangedate: '2026-11-07T18:20:31.412+1100',
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
      issues: [{ id: '10133', fields: { status: { statusCategory: { key: 'done' } }, statuscategorychangedate: '2026-11-07T18:20:31.412+1100' } }],
      isLast: true,
    })
    expect(JSON.stringify(result.recordings)).not.toMatch(/Someone|Synthetic|SYN-134|x-arequestid|Basic|warningMessages|lead/)
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
      else expect(`${url} ${body ?? ''}`).toMatch(new RegExp(`^https://api\\.atlassian\\.com/ex/jira/${CLOUD}/.*SYN`))
    }
  })

  test('records each failure the tracker gives: a refused token and an unknown project', async () => {
    const result = await recordJira(EMAIL, TOKEN, jira, jiraConnector)

    if (!result.ok) throw new Error(result.message)
    expect(result.recordings.refusedToken.map((recording) => recording.response.status)).toEqual([200, 401, 401])
    expect(result.recordings.unknown.map((recording) => recording.response.status)).toEqual([200, 404, 200, 404])
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
