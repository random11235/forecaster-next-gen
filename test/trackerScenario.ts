import { cannedConnector, type CannedFixture } from '../src/connectors/canned/cannedConnector.js'
import type { Choice, Ticket } from '../src/connectors/connector.js'
import { submitConnection } from '../src/forecast/connection.js'
import { inputsView, submitInputs, type InputsEdit, type InputsView, type Submitted } from '../src/forecast/inputs.js'
import { milestoneForecastView, type MilestoneForecastView } from '../src/forecast/milestoneForecastView.js'
import { submitStepQuery, type StepQuerySubmitted } from '../src/forecast/queryStep.js'
import { DEFAULT_SETTINGS } from '../src/forecast/settings.js'
import { submitSkip, type Skipping } from '../src/forecast/skippedPeriods.js'
import { MILESTONE_QUERY, type StepQuery } from '../src/forecast/stepQuery.js'
import type { TrackerReads } from '../src/forecast/trackerReads.js'
import { openMemorySecrets } from '../src/secrets/memorySecrets.js'
import type { ConnectionStorage, MilestoneQueryStorage, SavedReadStorage, SetupStorage, Storage } from '../src/storage/storage.js'
import { openSqliteStorage } from '../src/storage/sqliteStorage.js'

// A team on a tracker, for Seam B tests of what the tracker reads (#211–#215): its storage, a canned connector
// answering from a fixture the test can change between reads, and the Seam B entry points bound to them.

/** What the local server build stores, by the interfaces its tests use. */
export type TeamStorage = Storage & ConnectionStorage & SavedReadStorage & MilestoneQueryStorage & SetupStorage

export const TEAM = 'team'
/** A Thursday. */
export const TODAY = '2026-11-12'

export const CHECKOUT: Choice = { kind: 'milestone', name: 'Checkout v2', query: 'milestone:"Checkout v2"' }

/** The ISO calendar date the day after `day`. */
export const addDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

/** `count` open tickets, with ids from `prefix`. */
export const open = (count: number, prefix = 'o'): Ticket[] => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}` }))

/** `count` tickets finished at 10:00 UTC on `day`, with ids from `prefix`. */
export const finishedOn = (prefix: string, day: string, count: number): Ticket[] =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${day}-${i}`, finishedAt: `${day}T10:00:00Z` }))

/** Tickets finished `counts[i]` in the week starting on `weeks[i]` (a Monday), on its Tuesday. */
export const finishedInWeeks = (weeks: readonly string[], counts: readonly number[], prefix = 'w'): Ticket[] =>
  counts.flatMap((count, week) => finishedOn(prefix, addDay(weeks[week]!), count))

/** Whether a view is shown as the local server build shows it, reading the tracker, or as the browser build does. */
export interface Shown {
  connected?: boolean
}

/** A team on a tracker, with the Seam B entry points bound to it, in UTC, on `today`. */
export interface TrackerScenario {
  storage: TeamStorage
  /** What the canned connector answers from, as it is when read: change it to change what the next read finds. */
  fixture: CannedFixture
  /** What the Milestone step and skips read and save with. */
  using: Skipping
  /** What the views read of the tracker: the team's connection and saved reads, in UTC. */
  tracker: TrackerReads
  /** How far back each read asked the tracker for finished tickets, in order; clear it to count those after. */
  asked: string[]
  /** Connects the team to GitHub, or Jira. */
  connect(to?: 'github' | 'jira'): Promise<void>
  submit(edit: InputsEdit, shown?: Shown): Submitted
  inputs(shown?: Shown): InputsView
  forecast(shown?: Shown): MilestoneForecastView
  /** Picks `choice` in the step `stepQuery` edits (the Milestone step unless given), which reads its query at `readAt`. */
  pick(readAt: string, choice?: Choice, stepQuery?: StepQuery): Promise<StepQuerySubmitted>
  /**
   * Reads the milestone query again at `readAt`, as the Milestone step does: its pick removed, then picked again,
   * which reads it as far back as the milestone's inputs need.
   */
  readAgain(readAt: string, choice?: Choice): Promise<void>
  /** Skips the tracker's periods starting on `periods`, as at `readAt`. */
  skip(periods: string[], readAt: string): Promise<Submitted>
  /** Counts the skipped periods starting on `periods` again. */
  countAgain(periods: string[], readAt: string): Promise<Submitted>
  close(): void
}

/**
 * A team, `TEAM`, not yet connected, whose milestone query reads `tickets`, kept in memory; close it after. Its setup
 * is closed done, so what the steps pick and read is saved, as the forecast reads it; or, in a first setup
 * (`firstSetup`), open, so it is held in the setup draft until "Use these".
 */
export function trackerScenario({ tickets = [] as Ticket[], today = TODAY, firstSetup = false } = {}): TrackerScenario {
  const storage: TeamStorage = openSqliteStorage(':memory:')
  storage.saveTeam({ id: TEAM, name: 'My team', source: 'manual', sourceRef: '', installedAt: '2026-01-01T00:00:00Z' })
  if (!firstSetup) storage.saveSetupState(TEAM, { open: false, closed: 'done' })
  const fixture: CannedFixture = {
    milestoneChoices: [{ kind: 'milestone', choices: [CHECKOUT], pastLimit: false }],
    reads: { [CHECKOUT.query]: { tickets, incomplete: false } },
  }
  const asked: string[] = []
  const using: Skipping = {
    connections: storage,
    milestoneInputs: storage,
    reads: storage,
    milestoneQueries: storage,
    setup: storage,
    secrets: openMemorySecrets(),
    connector: () => {
      const canned = cannedConnector(fixture)
      return { ...canned, read: (query, finishedSince) => (asked.push(finishedSince), canned.read(query, finishedSince)) }
    },
  }
  const tracker: TrackerReads = { ...using, timeZone: 'UTC' }
  const reading = ({ connected = true }: Shown = {}) => ({ tracker: connected ? tracker : undefined })
  const at = (readAt: string) => ({ settings: DEFAULT_SETTINGS, today, readAt, timeZone: 'UTC' })
  const pick = (readAt: string, choice = CHECKOUT, stepQuery: StepQuery = MILESTONE_QUERY) =>
    submitStepQuery(using, TEAM, { kind: 'addPick', choice }, readAt, stepQuery)
  return {
    storage,
    fixture,
    using,
    tracker,
    asked,
    async connect(to = 'github') {
      const where =
        to === 'github'
          ? { tracker: 'github' as const, repo: 'shop-team/shop', site: '', projectKey: '', email: '' }
          : { tracker: 'jira' as const, repo: '', site: 'shop.atlassian.net', projectKey: 'SHOP', email: 'em@shop.test' }
      await submitConnection(using, TEAM, { kind: 'connect', ...where, token: 'token' })
    },
    submit: (edit, shown) => submitInputs(storage, TEAM, DEFAULT_SETTINGS, today, edit, reading(shown)),
    inputs: (shown) => inputsView(storage, TEAM, DEFAULT_SETTINGS, today, reading(shown)),
    forecast: (shown) => milestoneForecastView(storage, TEAM, DEFAULT_SETTINGS, today, reading(shown)),
    pick,
    async readAgain(readAt, choice = CHECKOUT) {
      await submitStepQuery(using, TEAM, { kind: 'removePick', query: choice.query }, readAt)
      await pick(readAt, choice)
    },
    skip: (periods, readAt) => submitSkip(using, TEAM, { kind: 'skip', periods }, at(readAt)),
    countAgain: (periods, readAt) => submitSkip(using, TEAM, { kind: 'countAgain', periods }, at(readAt)),
    close: () => storage.close(),
  }
}
