import { afterEach } from 'vitest'
import type { Choice } from '../../src/connectors/connector.js'
import { openSetup, type SetupContext } from '../../src/forecast/setup.js'
import { CHECKOUT, TEAM, TODAY, trackerScenario, type TrackerScenario } from '../trackerScenario.js'

// The arrangement the setup tests (setup.test.ts and the setup.*.test.ts beside it) share: a team not yet connected,
// one for each test, closed after it, and the means to open its setup.

export const READ_AT = '2026-11-12T09:05:00Z'
export const Q3_POLISH: Choice = { kind: 'milestone', name: 'Q3 polish', query: 'milestone:"Q3 polish"' }

let current: TrackerScenario | undefined

afterEach(() => {
  current?.close()
  current = undefined
})

/** The team the test arranged with `team()`. */
export function scenario(): TrackerScenario {
  if (current === undefined) throw new Error('No team yet: arrange one with team() first')
  return current
}

/** A team not yet connected, with Q3 polish to pick as comparable work. */
export function team(): TrackerScenario {
  current = trackerScenario({ firstSetup: true })
  current.fixture.milestoneChoices = [{ kind: 'milestone', choices: [CHECKOUT, Q3_POLISH], pastLimit: false }]
  current.fixture.reads[Q3_POLISH.query] = { tickets: [], incomplete: false }
  return current
}

export const settingUp = ({ using }: TrackerScenario): SetupContext => ({ ...using, timeZone: 'UTC', today: TODAY })

/** The Inputs screen opened at Check, as at `readAt`, which reads each pick the summary has no count for yet. */
export const atCheck = (readAt = READ_AT) => openSetup(settingUp(scenario()), TEAM, { asked: 'check' }, readAt)
