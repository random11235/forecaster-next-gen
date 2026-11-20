import type { Choice } from '../../src/connectors/connector.js'
import type { InputsScreen, Outcome, QuerySetupStep, SetupEdit, StepQueryEdit } from '../../src/forecast/index.js'
import { CHECKOUT, CONNECTIONS, forecastingForTest, type ForecastingForTest } from './forecastingForTest.js'

// The arrangement the setup tests (setup.test.ts and the setup.*.test.ts beside it) share: the team's handle on a
// team not yet connected, its setup open as on first launch, and the means to connect, edit and open its setup.

export const READ_AT = '2026-11-12T09:05:00Z'
export const Q3_POLISH: Choice = { kind: 'milestone', name: 'Q3 polish', query: 'milestone:"Q3 polish"' }

/** A team not yet connected, its setup open, with Q3 polish to pick as comparable work, its clock in `timeZone`. */
export function team({ timeZone = 'UTC' } = {}): Promise<ForecastingForTest> {
  return forecastingForTest({
    setupOpen: true,
    clock: { timeZone },
    fixture: {
      milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH], pastLimit: false }],
      reads: { [CHECKOUT.query]: { tickets: [], incomplete: false }, [Q3_POLISH.query]: { tickets: [], incomplete: false } },
    },
  })
}

/** Connects the team to GitHub, or Jira. */
export const connect = (team: ForecastingForTest, to: 'github' | 'jira' = 'github'): Promise<Outcome> =>
  team.submit({ form: 'connection', edit: CONNECTIONS[to] })

/** Setup as the Inputs screen shows it, opened at `step` as its URL names it, as at the clock's time. */
export const setupAt = async (team: ForecastingForTest, step?: string): Promise<InputsScreen['setup']> =>
  (await team.inputsScreen(step === undefined ? {} : { step })).setup

/** The Inputs screen opened at Check, as at `readAt`, which reads each pick the summary has no count for yet. */
export function atCheck(team: ForecastingForTest, readAt = READ_AT): Promise<InputsScreen['setup']> {
  team.at(readAt)
  return setupAt(team, 'check')
}

/** One of setup's own forms. */
export const setup = (team: ForecastingForTest, edit: SetupEdit): Promise<Outcome> => team.submit({ form: 'setup', edit })

/** "Use these", then the summary it closes to. */
export async function summary(team: ForecastingForTest): Promise<InputsScreen['setup']> {
  await setup(team, { kind: 'useThese' })
  return setupAt(team)
}

/** A query step's form, of the Milestone step unless `step` says, as at `readAt` if given. */
export function stepQuery(team: ForecastingForTest, edit: StepQueryEdit, step: QuerySetupStep = 'milestone', readAt?: string): Promise<Outcome> {
  if (readAt !== undefined) team.at(readAt)
  return team.submit({ form: 'stepQuery', step, edit })
}

/** The Inputs screen's inputs. */
export const inputs = async (team: ForecastingForTest) => (await team.inputsScreen()).inputs

/** Whether any of the milestone's picks on `view`, the summary, shows a count. */
export const anyCounted = (view: InputsScreen['setup']): boolean =>
  view?.kind === 'summary' && 'picks' in view.milestone && view.milestone.picks.some((pick) => 'count' in pick)
