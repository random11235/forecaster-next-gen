import { describe, expect, test } from 'vitest'
import type { Transport } from '../../../src/connectors/connector.js'
import { githubConnector } from '../../../src/connectors/github.js'
import { recordGithub } from '../../../scripts/record.js'

// The recording script's own logic, on a stand-in GitHub: what it keeps of each response, and what it says when the
// recording token is refused. The live run is `npm run record:github`.

const TOKEN = 'github_pat_recording-token-under-test'
const REPO_ID = 4242

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' } })
}

/** A stand-in GitHub that accepts only TOKEN, knows only the synthetic repo, and answers with more fields than are read. */
const github: Transport = async (url, init) => {
  if (new Headers(init?.headers).get('authorization') !== `Bearer ${TOKEN}`) {
    return json(401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' })
  }
  const known = url.includes('forecaster-synthetic/') || url.includes('forecaster-synthetic%20')
  // A search of labels names the repo by its id, which the repo itself gives.
  if (url.endsWith('/repos/random11235/forecaster-synthetic')) return json(200, { id: REPO_ID, name: 'forecaster-synthetic', owner: { login: 'someone' } })
  if (url.includes(`/search/labels?repository_id=${REPO_ID}&`)) {
    return json(200, { total_count: 1, incomplete_results: false, items: [{ id: 1, name: 'comparable', color: '0e8a16', description: 'Synthetic', score: 1 }] })
  }
  if (url.includes('/milestones')) {
    return known
      ? json(200, [{ title: 'Search revamp', number: 2, description: 'Synthetic', creator: { login: 'someone' }, open_issues: 3 }])
      : json(404, { message: 'Not Found', status: '404' })
  }
  if (url.includes('/labels')) {
    return known
      ? json(200, [{ id: 1, name: 'comparable', color: '0e8a16', description: 'Synthetic', url: 'https://api.github.com/someone' }])
      : json(404, { message: 'Not Found', status: '404' })
  }
  // Search names a repo it can't see with a 422, not a 404.
  if (!known) {
    const cannot = 'The listed users and repositories cannot be searched either because the resources do not exist or you do not have permission to view them.'
    return json(422, { message: 'Validation Failed', errors: [{ message: cannot, resource: 'Search', field: 'q', code: 'invalid' }], status: '422' })
  }
  return json(200, {
    total_count: 1,
    incomplete_results: false,
    items: [
      { node_id: 'I_1', number: 7, state: 'closed', closed_at: '2026-11-06T08:47:38Z', title: 'Search leaf 1', body: 'Synthetic', user: { login: 'someone' } },
    ],
    search_type: 'lexical',
  })
}

describe('the GitHub recording script', () => {
  test('keeps only the fields the connector reads, and no headers', async () => {
    const result = await recordGithub(TOKEN, github, githubConnector)

    if (!result.ok) throw new Error(result.message)
    const responses = result.recordings.synthetic.map((recording) => recording.response.body)
    expect(responses).toContainEqual([{ title: 'Search revamp' }])
    expect(responses).toContainEqual([{ name: 'comparable' }])
    expect(responses).toContainEqual({ id: REPO_ID })
    expect(responses).toContainEqual({ items: [{ name: 'comparable' }] })
    expect(responses).toContainEqual({
      total_count: 1,
      incomplete_results: false,
      items: [{ node_id: 'I_1', number: 7, title: 'Search leaf 1', state: 'closed', closed_at: '2026-11-06T08:47:38Z' }],
    })
    expect(JSON.stringify(result.recordings)).not.toMatch(/someone|Synthetic|ratelimit|Bearer/)
  })

  test('never writes the token into a recording', async () => {
    const result = await recordGithub(TOKEN, github, githubConnector)

    expect(JSON.stringify(result)).not.toContain(TOKEN)
  })

  test('records only from the synthetic repo', async () => {
    const result = await recordGithub(TOKEN, github, githubConnector)

    if (!result.ok) throw new Error(result.message)
    const urls = Object.values(result.recordings).flatMap((recordings) => recordings.map((recording) => decodeURIComponent(recording.request.url)))
    expect(urls.length).toBeGreaterThan(0)
    for (const url of urls) {
      // A search of labels names the synthetic repo by the id it gave.
      if (url.includes('/search/labels?')) expect(url).toContain(`repository_id=${REPO_ID}&`)
      else expect(url).toMatch(/^https:\/\/api\.github\.com\/.*random11235\/forecaster-synthetic/)
    }
  })

  test('records each failure the tracker gives: a refused token and an unknown repo', async () => {
    const result = await recordGithub(TOKEN, github, githubConnector)

    if (!result.ok) throw new Error(result.message)
    // The milestone choices, a search of choices and one for nothing, then the read from the start and from the cut.
    expect(result.recordings.refusedToken.map((recording) => recording.response.status)).toEqual([401, 401, 401, 401, 401])
    expect(result.recordings.unknown.map((recording) => recording.response.status)).toEqual([422, 422, 422, 422, 422])
  })

  test('says plainly when the recording token is refused, and records nothing', async () => {
    const result = await recordGithub('github_pat_expired', github, githubConnector)

    expect(result).toEqual({ ok: false, message: expect.stringContaining('GitHub refused the recording token') })
    if (result.ok) return
    expect(result.message).toContain('forecaster-github-recording')
    expect(result.message).toContain('2026-12-07')
  })
})
