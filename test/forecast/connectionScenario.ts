import type { CannedFixture } from '../../src/connectors/canned.js'
import type { ConnectionEdit, ConnectStep, Outcome } from '../../src/forecast/index.js'
import { forecastingForTest, TEAM, type ForecastingForTest } from './forecastingForTest.js'

// The arrangement connection.test.ts and connection.refused.test.ts share: the team's handle, its setup open as on
// first launch, on the canned connector to connect to.

export { TEAM }
export const TOKEN = 'github_pat_11ABCDEFG0123456789_secret'

const CHOICES: CannedFixture = {
  milestoneChoices: [{ kind: 'milestone', choices: [{ kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }], pastLimit: false }],
  reads: {},
}

/** The team's handle, not yet connected, the canned connector answering `milestoneChoices` with `answer`. */
export function newTeam(answer: CannedFixture['milestoneChoices'] = CHOICES.milestoneChoices): Promise<ForecastingForTest> {
  return forecastingForTest({ fixture: { milestoneChoices: answer, reads: {} }, setupOpen: true })
}

/** The team's handle as the browser build opens it, with nothing to connect with. */
export function browserTeam(): Promise<ForecastingForTest> {
  return forecastingForTest({ browser: true, setupOpen: true })
}

/** Submits the Connect step's form. */
export function connect(team: ForecastingForTest, edit: ConnectionEdit): Promise<Outcome> {
  return team.submit({ form: 'connection', edit })
}

/** The Connect step a refused submit shows again. */
export function refusedStep(outcome: Outcome): ConnectStep | undefined {
  return !outcome.saved && 'screen' in outcome && outcome.screen === 'inputs' ? outcome.view.connection : undefined
}

/** Why the Connect step's submit was refused. */
export function refusal(outcome: Outcome): string | undefined {
  return refusedStep(outcome)?.refusal
}

/** The Connect step, as the Inputs screen shows it. */
export async function connectStep(team: ForecastingForTest): Promise<ConnectStep | undefined> {
  return (await team.inputsScreen()).connection
}

export function github(repo = 'shop-team/shop', token = TOKEN): ConnectionEdit {
  return { kind: 'connect', tracker: 'github', repo, site: '', projectKey: '', email: '', token }
}

export function jira(fields: Partial<{ site: string; projectKey: string; email: string; token: string }> = {}): ConnectionEdit {
  return { kind: 'connect', tracker: 'jira', repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.example', token: TOKEN, ...fields }
}

/** The permissions each tracker's token needs, as the Connect step names them. */
export const PERMISSIONS = { github: 'Issues: read', jira: 'read:jira-work' }
/** Each tracker's name, as the Connect step offers it. */
export const TRACKER_NAMES = { github: 'GitHub', jira: 'Jira' }
