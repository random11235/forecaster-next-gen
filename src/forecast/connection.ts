import type { Connector, Failure } from '../connectors/connector.js'
import type { Connection } from '../model/connection.js'
import type { Secrets } from '../secrets/secrets.js'
import type { ConnectionStorage } from '../storage/storage.js'

/** A tracker a team can connect to. */
export type Tracker = Connection['tracker']

/** Builds the connector for a connection and its token: the real one in the local server build, the canned one in tests and demo mode. */
export type ConnectorFactory = (connection: Connection, token: string) => Connector

/**
 * What the local server build connects with: where the connection is kept, where its token is kept, and how a
 * connector is built. The browser build has none of these, so it has no Connect step.
 */
export interface Connecting {
  connections: ConnectionStorage
  secrets: Secrets
  connector: ConnectorFactory
}

/** The Connect step's form as typed, all but the token, which is never shown back. GitHub's repo is `owner/repo`. */
export interface ConnectionForm {
  tracker: Tracker
  repo: string
  site: string
  projectKey: string
  email: string
}

/** The Connect step's submits: connect (or change the connection to) what the form names, or disconnect. */
export type ConnectionEdit = ({ kind: 'connect'; token: string } & ConnectionForm) | { kind: 'disconnect' }

/** The read-only permission a token needs, by tracker: what the EM is told to create. */
export const TOKEN_PERMISSIONS: Readonly<Record<Tracker, string>> = { github: 'Issues: read', jira: 'read:jira-work' }

/** What the Connect step shows. */
export interface ConnectionView {
  kind: 'connect'
  form: ConnectionForm
  permissions: Readonly<Record<Tracker, string>>
  /** Why the connect just submitted was refused; none until one is. */
  refusal?: string
}

/** The setup step to go to next: Connect, or, once connected, picking the milestone's tickets. */
export type SetupStep = 'connect' | 'milestone'

/** A connection saved (or removed), and the setup step to go to next; or refused, with the Connect step to show again. */
export type ConnectionSubmitted = { saved: true; next: SetupStep } | { saved: false; view: ConnectionView & { refusal: string } }

/** Seam B: checks the connection the EM submitted by asking its tracker for milestone choices, and saves it if it answers. */
export async function submitConnection(connecting: Connecting, teamId: string, edit: ConnectionEdit): Promise<ConnectionSubmitted> {
  if (edit.kind === 'disconnect') throw new Error('not yet')
  const { token, kind: _, ...form } = edit
  const [owner = '', repo = ''] = form.repo.split('/')
  const connection: Connection = { tracker: 'github', owner, repo }
  const checked = await connecting.connector(connection, token).milestoneChoices()
  if (!checked.ok) return { saved: false, view: { kind: 'connect', form, permissions: TOKEN_PERMISSIONS, refusal: refusalOf(checked) } }
  await connecting.secrets.saveToken(teamId, token)
  connecting.connections.saveConnection(teamId, connection)
  return { saved: true, next: 'milestone' }
}

/** A failed connection check, worded for the Connect step. */
function refusalOf(failure: Failure): string {
  switch (failure.failure) {
    case 'unauthorised':
      return 'GitHub refused the token. Check it hasn’t expired, and that it has Issues: read on this repo.'
    default:
      return ''
  }
}

export function connectionView(): void {}
