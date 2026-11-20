import type { Connector, Failure } from '../../connectors/connector.js'
import type { Connection } from '../../model/connection.js'
import type { Secrets } from '../../secrets/secrets.js'
import type { ConnectionStorage, QueryTarget, SetupStorage, TeamQueries, TeamQueryStorage } from '../../storage/storage.js'
import type { SetupStep } from './setupSteps.js'
import { BLANK_CONNECTION_FORM, connectionOf, TRACKERS, trackerOf, type ConnectionForm, type Tracker } from './trackers.js'

/** Builds the connector for a connection and its token: the real one in the local server build, the canned one in tests and demo mode. */
type ConnectorFactory = (connection: Connection, token: string) => Connector

/**
 * What the local server build connects with: where the connection is kept, where its token is kept, how a connector is
 * built, where the milestone's picks and query and their reads are kept, by target (`teamQueries`: setup's draft is
 * held behind it), and how setup was closed. The browser build has none of these, so it has no setup steps.
 */
export interface Connecting {
  connections: ConnectionStorage
  queries: TeamQueryStorage
  setup: SetupStorage
  secrets: Secrets
  connector: ConnectorFactory
}

/** `connecting` with the team's queries and their reads in `target`: the one way `forecast/` asks for a target. */
export function withTeamQueries<T extends Pick<Connecting, 'queries'>>(connecting: T, target: QueryTarget): T & TeamQueries {
  return { ...connecting, ...connecting.queries.teamQueries(target) }
}

/**
 * The Connect step's submits: connect (or change the connection to) what the form names, or disconnect. While
 * connected, a blank token keeps the saved one.
 */
export type ConnectionEdit = ({ kind: 'connect'; token: string } & ConnectionForm) | { kind: 'disconnect' }

/** The read-only permission a token needs, by tracker: what the EM is told to create. */
export const TOKEN_PERMISSIONS: Readonly<Record<Tracker, string>> = { github: TRACKERS.github.permission, jira: TRACKERS.jira.permission }

/** Each tracker's name, as the Connect step offers it. */
const TRACKER_NAMES: Readonly<Record<Tracker, string>> = { github: TRACKERS.github.name, jira: TRACKERS.jira.name }

/**
 * What the Connect step shows: in the browser build, nothing (`noConnect`); otherwise its form, blank until the team
 * connects (`connect`), then the connection, with its form filled in to change it (`connected`).
 */
export type ConnectionView = { kind: 'noConnect' } | ConnectStep

/** The Connect step, before connecting or once connected. */
export type ConnectStep = (
  | { kind: 'connect' }
  /** Connected to `connection`: its tracker's name (`trackerName`), and where it reads, as the step says it (`where`). */
  | { kind: 'connected'; connection: Connection; trackerName: string; where: string }
) & {
  /** As saved, or as typed when refused; never with the token. */
  form: ConnectionForm
  /** The read-only permission to create each tracker's token with. */
  permissions: Readonly<Record<Tracker, string>>
  /** Each tracker's name, as the form offers it. */
  trackerNames: Readonly<Record<Tracker, string>>
  /** Why the form just submitted was refused; none until one is. */
  refusal?: string
}

/** A connection saved (or removed), and the setup step to go to next: Connect, or, once connected, Milestone; or refused, with the Connect step to show again. */
export type ConnectionSubmitted = { saved: true; next: Extract<SetupStep, 'connect' | 'milestone'> } | { saved: false; view: ConnectStep & { refusal: string } }

/**
 * Seam B: connects the team, changes its connection, or disconnects it.
 *
 * A connect (or a change, while connected) is checked by building its connector and asking for milestone choices.
 * While connected, a change with the token left blank is checked with the saved token, so a new repo needs no new
 * token. Answered, the connection and the token replace any the team had, and the milestone step is next. Refused,
 * nothing changes, and the Connect step shows again with why and the form as typed, without the token. A missing name,
 * or a missing token with none saved, is refused before any connector is built.
 *
 * A disconnect removes the connection and forgets the token, going back to the Connect step. A value following the
 * tracker is then typed, as with no connection it is (`measure`); its source is kept, so it follows again once the
 * team reconnects.
 *
 * Should this computer's keychain or the data file fail, nothing changes: what was written is put back, and the
 * refusal says which failed, never quoting its error.
 *
 * While setup is open, a saved change is noted on it: a connection made where there was none, which Cancel removes,
 * or the one there was changed, after which setup can't be cancelled (`noteConnectionChange`).
 */
export async function submitConnection(connecting: Connecting, teamId: string, edit: ConnectionEdit): Promise<ConnectionSubmitted> {
  const before = connecting.connections.connection(teamId)
  const submitted = edit.kind === 'disconnect' ? await disconnect(connecting, teamId) : await connect(connecting, teamId, edit)
  if (submitted.saved) noteConnectionChange(connecting, teamId, before)
  return submitted
}

/**
 * While setup is open, what its opening has done to the connection, now `before` it changed: made it, where the team
 * had none, or changed (or removed) the one it had, for Cancel to undo or refuse. Once made or changed, it stays so.
 */
function noteConnectionChange({ setup, connections }: Connecting, teamId: string, before: Connection | undefined): void {
  const state = setup.setupState(teamId)
  if (!state.open || state.connection) return
  const after = connections.connection(teamId)
  const connection = JSON.stringify(after) === JSON.stringify(before) ? undefined : before === undefined ? 'made' : 'changed'
  if (connection) setup.saveSetupState(teamId, { ...state, connection })
}

/** A connect, or a change while connected: checked, then saved. */
async function connect(connecting: Connecting, teamId: string, edit: Extract<ConnectionEdit, { kind: 'connect' }>): Promise<ConnectionSubmitted> {
  const { tracker, repo, site, projectKey, email } = edit
  const form: ConnectionForm = { tracker, repo, site, projectKey, email }
  const refused = (refusal: string): ConnectionSubmitted => ({ saved: false, view: { ...connectStep(connecting, teamId), form, refusal } })
  const connection = connectionOf(form)
  const missing = trackerOf(connection).missing(connection)
  if (missing) return refused(missing)
  const typed = edit.token.trim()
  const token = typed || (await savedToken(connecting, teamId))
  if (typeof token !== 'string') return refused(token.refusal)
  const checked = await connecting.connector(connection, token).milestoneChoices()
  if (!checked.ok) return refused(refusalOf(connection, checked))
  const failed = await replaceConnection(connecting, teamId, connection, typed || undefined)
  return failed ? refused(failed) : { saved: true, next: 'milestone' }
}

/** The token a change with a blank token is checked with: the one saved, while the team is connected. */
async function savedToken({ connections, secrets }: Connecting, teamId: string): Promise<string | { refusal: string }> {
  const noToken = { refusal: 'Paste a token to connect.' }
  if (!connections.connection(teamId)) return noToken
  try {
    return (await secrets.token(teamId)) || noToken
  } catch {
    return { refusal: KEYCHAIN_FAILED }
  }
}

/** Why a connect or disconnect changed nothing, when this computer's keychain failed: its own error is never shown. */
const KEYCHAIN_FAILED = 'This computer’s keychain couldn’t be used, so nothing changed. Check it’s unlocked and that the Forecaster may use it, then try again.'

/** Why a connect or disconnect changed nothing, when the data file failed. */
const DATA_FILE_FAILED = 'The data file couldn’t be written, so nothing changed. Try again.'

/**
 * Saves the team's connection, then its new token (none when the saved one is kept), so the two stay together:
 * should the keychain fail, the connection the team had (or none) is put back. Returns why nothing changed, if it didn't.
 */
async function replaceConnection(
  { connections, secrets }: Connecting,
  teamId: string,
  connection: Connection,
  token: string | undefined,
): Promise<string | undefined> {
  const before = connections.connection(teamId)
  try {
    connections.saveConnection(teamId, connection)
  } catch {
    return DATA_FILE_FAILED
  }
  if (token === undefined) return undefined
  try {
    await secrets.saveToken(teamId, token)
  } catch {
    putBack(connections, teamId, before)
    return KEYCHAIN_FAILED
  }
  return undefined
}

/**
 * Removes the team's connection, then forgets its token, so the two go together: should the keychain fail, the
 * connection is put back and the team is still connected.
 */
async function disconnect(connecting: Connecting, teamId: string): Promise<ConnectionSubmitted> {
  const { connections, secrets } = connecting
  const before = connections.connection(teamId)
  const refused = (refusal: string): ConnectionSubmitted => ({ saved: false, view: { ...connectStep(connecting, teamId), refusal } })
  try {
    connections.removeConnection(teamId)
  } catch {
    return refused(DATA_FILE_FAILED)
  }
  try {
    await secrets.deleteToken(teamId)
  } catch {
    putBack(connections, teamId, before)
    return refused(KEYCHAIN_FAILED)
  }
  return { saved: true, next: 'connect' }
}

/** Puts back the connection the team had (or none). Should the data file fail again, it is left as it is: a later read refuses its token. */
function putBack(connections: ConnectionStorage, teamId: string, connection: Connection | undefined): void {
  try {
    if (connection) connections.saveConnection(teamId, connection)
    else connections.removeConnection(teamId)
  } catch {
    // the refusal already says to try again
  }
}

/** A failed connection check, worded for the Connect step. */
function refusalOf(connection: Connection, { failure }: Failure): string {
  const tracker = trackerOf(connection)
  switch (failure) {
    case 'unauthorised':
      return tracker.refused(connection)
    case 'notFound':
      return tracker.notFound(connection)
    case 'unavailable':
      return `${tracker.name} can’t be reached just now, or is limiting requests. Try again in a few minutes.`
    // the check asks for no query of the EM's, so neither is expected of it
    case 'invalidQuery':
    case 'outOfScope':
      return `${tracker.name} didn’t accept the connection check. Try again, and if it fails again, check what you typed.`
  }
}

/** A team's connection, and the connector for it and its saved token: `keychainFailed` when this computer's keychain can't give the token. */
export interface TeamConnection {
  connection: Connection
  connector: Connector | 'keychainFailed'
}

/** The team's connection with its connector; none while the team has no connection. */
export async function teamConnection({ connections, secrets, connector }: Connecting, teamId: string): Promise<TeamConnection | undefined> {
  const connection = connections.connection(teamId)
  if (!connection) return undefined
  try {
    const token = await secrets.token(teamId)
    return { connection, connector: token ? connector(connection, token) : 'keychainFailed' }
  } catch {
    return { connection, connector: 'keychainFailed' }
  }
}

/** Seam B: the team's Connect step; none in the browser build, which has nothing to connect with (`connecting` undefined). */
export function connectionView(connecting: Connecting | undefined, teamId: string): ConnectionView {
  return connecting ? connectStep(connecting, teamId) : { kind: 'noConnect' }
}

function connectStep({ connections }: Connecting, teamId: string): ConnectStep {
  const connection = connections.connection(teamId)
  const named = { permissions: TOKEN_PERMISSIONS, trackerNames: TRACKER_NAMES }
  if (!connection) return { kind: 'connect', form: BLANK_CONNECTION_FORM, ...named }
  const tracker = trackerOf(connection)
  return { kind: 'connected', connection, trackerName: tracker.name, where: tracker.where(connection), form: tracker.formOf(connection), ...named }
}
