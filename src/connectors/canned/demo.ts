import type { Connection } from '../../model/connection.js'
import type { Connector, Failure } from '../connector.js'
import { cannedConnector, type CannedFixture } from './cannedConnector.js'
import fixture from './demoFixture.json' with { type: 'json' }

/** The token demo mode refuses, as a tracker refuses an expired or wrong one. */
const DEMO_REFUSED_TOKEN = 'refused'

/** The repo or Jira project name demo mode can't find, as a tracker can't find a misspelt one. */
const DEMO_UNKNOWN_NAME = 'unknown'

/**
 * The reads demo mode fails, as a tracker fails them, to show the Milestone step's flags: a query the tracker rejects,
 * with its message, and one reaching outside the connection. Kept here, not in the fixture, which JSON can't type.
 */
const DEMO_FAILED_READS: CannedFixture['reads'] = {
  'closed:>2026-13-45': {
    failure: 'invalidQuery',
    message: '"2026-13-45" is not a recognized date/time format. Please provide an ISO 8601 date/time value, such as YYYY-MM-DD.',
  },
  'repo:someone/else': { failure: 'outOfScope' },
}

/** The fixture. JSON types each choice's kind as any string, so `test/connectors/cannedConnector.test.ts` checks each is a kind. */
const DEMO_FIXTURE = fixture as CannedFixture

/**
 * Demo mode's connector: canned, from a committed synthetic fixture (made up for demos, holding no real team's data),
 * so demo screenshots and the launch smoke test need no tracker or token. Any connection and token connect, but for
 * two cues that show the Connect step's refusals: the token `refused` is refused (`unauthorised`), and a repo or Jira
 * project named `unknown` (in any case) isn't found (`notFound`). Reads of `DEMO_FAILED_READS`' queries fail.
 */
export function demoConnector(connection: Connection, token: string): Connector {
  const failure = cuedFailure(connection, token)
  if (!failure) return cannedConnector({ ...DEMO_FIXTURE, reads: { ...DEMO_FIXTURE.reads, ...DEMO_FAILED_READS } })
  // a refused token or an unknown repo fails every call, as it would on the tracker
  return {
    milestoneChoices: async () => ({ ok: false, ...failure }),
    searchChoices: async () => ({ ok: false, ...failure }),
    read: async () => ({ ok: false, ...failure }),
  }
}

function cuedFailure(connection: Connection, token: string): Failure | undefined {
  if (token.trim() === DEMO_REFUSED_TOKEN) return { failure: 'unauthorised' }
  const name = connection.tracker === 'github' ? connection.repo : connection.projectKey
  if (name.toLowerCase() === DEMO_UNKNOWN_NAME) return { failure: 'notFound' }
  return undefined
}
