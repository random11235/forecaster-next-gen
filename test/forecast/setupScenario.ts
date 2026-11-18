import { afterEach } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { openSetup, type SetupContext } from '../../src/forecast/setup.js'
import { CHECKOUT, TEAM, TODAY, trackerScenario, type TrackerScenario } from '../trackerScenario.js'

// The arrangement the setup tests (setup.test.ts and the setup.*.test.ts beside it) share: a team not yet connected,
// one for each test, closed after it, and the means to open its setup.

export const READ_AT = '2026-11-12T09:05:00Z'
export const Q3_POLISH: Choice = { kind: 'milestone', name: 'Q3 polish', query: 'milestone:"Q3 polish"' }

export let scenario: TrackerScenario | undefined

afterEach(() => {
  scenario?.close()
  scenario = undefined
})

/** A team not yet connected, with Q3 polish to pick as comparable work. */
export function team(): TrackerScenario {
  scenario = trackerScenario({ firstSetup: true })
  scenario.fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH], pastLimit: false }]
  scenario.fixture.reads[Q3_POLISH.query] = { tickets: [], incomplete: false }
  return scenario
}

export const settingUp = ({ using }: TrackerScenario): SetupContext => ({ ...using, timeZone: 'UTC', today: TODAY })

/** The Inputs screen opened at Check, as at `readAt`, which reads each pick the summary has no count for yet. */
export const atCheck = (readAt = READ_AT) => openSetup(settingUp(scenario!), TEAM, { asked: 'check' }, readAt)
