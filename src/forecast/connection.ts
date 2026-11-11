import type { Connector } from '../connectors/connector.js'
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

/** The setup step to go to next: Connect, or, once connected, picking the milestone's tickets. */
export type SetupStep = 'connect' | 'milestone'

export type ConnectionSubmitted = { saved: true; next: SetupStep }

/** Seam B: checks the connection the EM submitted by asking its tracker for milestone choices, and saves it if it answers. */
export async function submitConnection(connecting: Connecting, teamId: string, edit: ConnectionEdit): Promise<ConnectionSubmitted> {
  if (edit.kind === 'disconnect') throw new Error('not yet')
  const [owner = '', repo = ''] = edit.repo.split('/')
  const connection: Connection = { tracker: 'github', owner, repo }
  await connecting.connector(connection, edit.token).milestoneChoices()
  await connecting.secrets.saveToken(teamId, edit.token)
  connecting.connections.saveConnection(teamId, connection)
  return { saved: true, next: 'milestone' }
}

export function connectionView(): void {}
