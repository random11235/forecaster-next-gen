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
  const refused = (refusal: string): ConnectionSubmitted => ({ saved: false, view: { kind: 'connect', form, permissions: TOKEN_PERMISSIONS, refusal } })
  const connection = connectionOf(form)
  const missing = missingFrom(connection, token.trim())
  if (missing) return refused(missing)
  const checked = await connecting.connector(connection, token.trim()).milestoneChoices()
  if (!checked.ok) return refused(refusalOf(connection, checked))
  await connecting.secrets.saveToken(teamId, token.trim())
  connecting.connections.saveConnection(teamId, connection)
  return { saved: true, next: 'milestone' }
}

/** The connection the form names, tidied: no stray spaces, a Jira site without its scheme or slash, its project key in capitals. */
function connectionOf(form: ConnectionForm): Connection {
  if (form.tracker === 'jira') {
    const site = form.site.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    return { tracker: 'jira', site, projectKey: form.projectKey.trim().toUpperCase(), email: form.email.trim() }
  }
  const parts = form.repo.trim().split('/')
  // anything but owner/repo names no repo, so it is refused as missing
  const [owner = '', repo = ''] = parts.length === 2 ? parts : []
  return { tracker: 'github', owner, repo }
}

/** What the connection or its token lacks, worded for the Connect step; nothing when it has all it needs to be checked. */
function missingFrom(connection: Connection, token: string): string | undefined {
  if (connection.tracker === 'github') {
    if (!connection.owner || !connection.repo) return 'Give the repo as owner/repo, like shop-team/shop.'
  } else {
    if (!connection.site) return 'Give the Jira site, like your-team.atlassian.net.'
    if (!connection.projectKey) return 'Give the Jira project key, like SHOP.'
    if (!connection.email) return 'Give the email of the Atlassian account that made the token.'
  }
  if (!token) return 'Paste a token to connect.'
  return undefined
}

/** A failed connection check, worded for the Connect step. */
function refusalOf(connection: Connection, { failure }: Failure): string {
  const github = connection.tracker === 'github'
  const tracker = github ? 'GitHub' : 'Jira'
  switch (failure) {
    case 'unauthorised':
      return github
        ? `GitHub refused the token. Check it hasn’t expired, and that it has ${TOKEN_PERMISSIONS.github} on this repo.`
        : `Jira refused the token. Check it hasn’t expired, that it has ${TOKEN_PERMISSIONS.jira}, and that ${connection.email} is the account that made it.`
    case 'notFound':
      return github
        ? `GitHub can’t see ${connection.owner}/${connection.repo} with this token. Check the repo’s name, and that the token covers it.`
        : `Jira can’t find project ${connection.projectKey} on ${connection.site} with this token. Check the site and the project key, and that the account can see it.`
    case 'unavailable':
      return `${tracker} can’t be reached just now, or is limiting requests. Try again in a few minutes.`
    // the check asks for no query of the EM's, so neither is expected of it
    case 'invalidQuery':
    case 'outOfScope':
      return `${tracker} didn’t accept the connection check. Try again, and if it fails again, check what you typed.`
  }
}

export function connectionView(): void {}
