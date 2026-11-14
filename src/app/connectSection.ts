import type { ConnectionEdit, ConnectionView, ConnectStep } from '../forecast/connection.js'
import { TRACKERS, trackerOf, type Tracker } from '../forecast/trackers.js'
import type { Connection } from '../model/connection.js'
import { escapeHtml } from './html.js'
import { SETUP_PATHS } from './setupSection.js'

/** Where the Connect step's forms post: connect (or change the connection), and disconnect. */
export const CONNECT_PATHS = { connect: '/inputs/connect', disconnect: '/inputs/connect/disconnect' } as const

/** Reads a submitted Connect form, by the field names this section gives them; the connection is checked when it is submitted. */
type ConnectFormReader = (body: URLSearchParams) => ConnectionEdit

/** Each form the Connect step posts, by its action's path, and how its fields are read. */
export const CONNECT_FORMS: ReadonlyMap<string, ConnectFormReader> = new Map<string, ConnectFormReader>([
  [
    CONNECT_PATHS.connect,
    (body) => ({
      kind: 'connect',
      tracker: body.get('tracker') === 'jira' ? 'jira' : 'github',
      repo: body.get('repo') ?? '',
      site: body.get('site') ?? '',
      projectKey: body.get('projectKey') ?? '',
      email: body.get('email') ?? '',
      token: body.get('token') ?? '',
    }),
  ],
  [CONNECT_PATHS.disconnect, () => ({ kind: 'disconnect' })],
])

/**
 * The Connect step, the first of the setup steps in the local server build; none in the browser build. It
 * posts as a whole when Connect is pressed, never as each field changes, as its check asks the tracker. The token
 * field is always blank: the token is never put back into the page. Once connected, leaving it blank keeps the saved token.
 */
export function connectSection(view: ConnectionView): string | undefined {
  if (view.kind === 'noConnect') return undefined
  return view.kind === 'connected' ? connectedBody(view, view.connection) : connectForm(view, 'Connect')
}

/** What the section says in its label column. */
export const CONNECT_HINT = 'Connect one GitHub repo or Jira project, to read the milestone’s tickets from it. Or skip, and type the inputs below.'

function connectedBody(step: ConnectStep, connection: Connection): string {
  const refused = step.refusal !== undefined
  const tracker = trackerOf(connection)
  return `        <div class="connection">
          <span class="ok-dot" aria-hidden="true"></span>
          <span>Connected to ${tracker.name} · <b>${escapeHtml(tracker.where(connection))}</b></span>
          <form method="post" action="${CONNECT_PATHS.disconnect}#connect">
            <button type="submit" class="linkish">Disconnect</button>
          </form>
        </div>
        <details class="change"${refused ? ' open' : ''}>
          <summary>Change the connection</summary>
${connectForm(step, 'Change connection')}
        </details>`
}

function connectForm({ form, permissions, refusal, kind }: ConnectStep, button: string): string {
  const tracker = (option: Tracker): string =>
    `              <label><input type="radio" name="tracker" value="${option}"${option === form.tracker ? ' checked' : ''} required> ${TRACKERS[option].name}</label>`
  const field = (label: string, name: string, value: string, placeholder: string, wide = true, type = 'text'): string =>
    `              <label${wide ? ' class="wide"' : ''}>${label} <input type="${type}" name="${name}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" spellcheck="false"></label>`
  const skip =
    kind === 'connect' ? `\n            <button type="submit" formaction="${SETUP_PATHS.skip}" formnovalidate class="linkish skip">Skip: type the inputs instead</button>` : ''
  return `        <form method="post" action="${CONNECT_PATHS.connect}#connect" class="connect">${refusal === undefined ? '' : `\n          <p class="error" role="alert">${escapeHtml(refusal)}</p>`}
          <fieldset class="levels trackers" aria-label="Tracker">
${tracker('github')}
${tracker('jira')}
          </fieldset>
          <div class="fields github">
${field('Repo', 'repo', form.repo, 'owner/repo')}
          </div>
          <div class="fields jira">
${field('Site', 'site', form.site, 'your-team.atlassian.net')}
${field('Project key', 'projectKey', form.projectKey, 'SHOP', false)}
${field('Account email', 'email', form.email, 'the account that made the token', true, 'email')}
          </div>
          <div class="fields">
              <label class="wide">Token <input type="password" name="token" value="" placeholder="${kind === 'connected' ? 'blank keeps the saved token' : 'read-only, never shown again'}" autocomplete="off"></label>
          </div>
          <p class="note">Make a read-only token: on GitHub a fine-grained token with <b>${escapeHtml(permissions.github)}</b> on the one repo; on Jira a scoped API token with <b>${escapeHtml(permissions.jira)}</b>. Nothing is ever written to the tracker. The token is kept in this computer’s keychain, never in the page or the data file.</p>
          <div class="actions">${skip}
            <button type="submit" class="primary">${button}</button>
          </div>
        </form>`
}
