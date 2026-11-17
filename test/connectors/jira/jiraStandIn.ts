import type { Transport } from '../../../src/connectors/connector.js'
import { answering } from '../backoff.js'

// The arrangement the Jira connector's test files share: a connection, a window's start, and stand-in Jiras.

export const CONNECTION = { tracker: 'jira', site: 'example.atlassian.net', projectKey: 'SYN', email: 'someone@example.com' } as const
export const SINCE = '2026-01-01T00:00:00Z'

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A stand-in Jira that gives its cloud id, then answers each call through the gateway with `answer`. */
export function answeringPastTenant(answer: Transport) {
  return answering(async (url, init) => (url.endsWith('/_edge/tenant_info') ? json(200, { cloudId: 'cloud-1' }) : answer(url, init)))
}

export function throughGateway(url: string): boolean {
  return !url.endsWith('/_edge/tenant_info')
}

/** What a stand-in Jira lists for milestone choices: its fix versions, and the first page of its epics and labels. */
export interface Listing {
  versions?: { id: string; name: string; released: boolean; archived: boolean }[]
  /** The epics the first page of the epics search finds; `moreEpics` when there is another page. */
  epics?: { key: string; summary: string }[]
  moreEpics?: boolean
  /** The labels the first page of the site's labels gives; `moreLabels` when there is another page. */
  labels?: string[]
  moreLabels?: boolean
}

/** A stand-in Jira listing `listing`, past its cloud id. */
export function jiraListing(listing: Listing) {
  return answeringPastTenant(async (url) => {
    if (url.endsWith('/project/SYN/versions')) return json(200, listing.versions ?? [])
    if (url.endsWith('/search/jql')) {
      const issues = (listing.epics ?? []).map(({ key, summary }, i) => ({ id: String(20000 + i), key, fields: { summary } }))
      return json(200, listing.moreEpics ? { issues, isLast: false, nextPageToken: 'page-2' } : { issues, isLast: true })
    }
    if (url.includes('/label?')) return json(200, { values: listing.labels ?? [], isLast: !listing.moreLabels })
    return json(404, {})
  })
}

/** `count` things, each made by `make` from its number, counting from 1. */
export function many<T>(count: number, make: (n: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i + 1))
}
