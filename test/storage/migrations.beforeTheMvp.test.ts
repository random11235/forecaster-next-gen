import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { inputsView, submitInputs } from '../../src/forecast/inputs.js'
import { milestoneForecastView } from '../../src/forecast/milestoneForecastView.js'
import { DEFAULT_SETTINGS } from '../../src/forecast/settings.js'
import type { MilestoneInputs } from '../../src/model/milestoneInputs.js'
import type { Team } from '../../src/model/team.js'
import { fileIn, closeStorage, open, rowsOf, EDITED_RANGES } from './migrationsHarness.js'
import { CREATED } from './pastSchemas.js'

// Opening a data file an earlier release left: see migrationsHarness.ts.

describe('a data file from before the MVP, at the current version', () => {
  // Beside the MVP's fields, the file holds the rows earlier releases wrote: epics, a milestone with a committed date,
  // measured pace, a workflow, an epic commit and ambiguity, and measured growth adopted. The MVP reads none of them.
  const PAY = 'PAY'
  const EARLIER_RELEASE_ROWS = `
INSERT INTO work_items (team_id, id, source_key, type, title, parent_id, labels, created_at, started_at, done_at, cancelled_at, last_synced_at) VALUES
  ('${PAY}', 'PAY-1', 'PAY-1', 'epic', 'Card vaulting', NULL, '["committed"]', '${CREATED}', NULL, NULL, NULL, '${CREATED}'),
  ('${PAY}', 'PAY-2', 'PAY-2', 'epic', 'Refunds', NULL, '[]', '${CREATED}', NULL, NULL, NULL, '${CREATED}'),
  ('${PAY}', 'PAY-11', 'PAY-11', 'story', NULL, 'PAY-1', '[]', '${CREATED}', NULL, NULL, NULL, '${CREATED}');
INSERT INTO milestones (team_id, id, name, committed_date) VALUES ('${PAY}', 'M1', 'Checkout v2', '2026-12-18');
INSERT INTO milestone_epics (team_id, milestone_id, rank, epic_id) VALUES ('${PAY}', 'M1', 0, 'PAY-1'), ('${PAY}', 'M1', 1, 'PAY-2');
INSERT INTO pace_settings (team_id, milestone_id, mode, low, high) VALUES ('${PAY}', 'M1', 'measured', 2, 9);
INSERT INTO workflow_settings (team_id, statuses, started_status, commit_label, blocked_statuses, blocked_labels) VALUES
  ('${PAY}', '[{"status":"To Do","category":"notStarted"},{"status":"In Progress","category":"started"},{"status":"Done","category":"done"}]',
   'In Progress', 'committed', '[]', '["blocked"]');
INSERT INTO epic_commits (team_id, epic_id, committed_at, child_count_at_commit) VALUES ('${PAY}', 'PAY-2', '2026-09-07T10:00:00Z', 1);
INSERT INTO epic_ambiguities (team_id, milestone_id, epic_id, ambiguity) VALUES ('${PAY}', 'M1', 'PAY-1', 'high');
INSERT INTO ambiguity_ranges (team_id, low_low, low_high, medium_low, medium_high, high_low, high_high, medium_measured) VALUES
  ('${PAY}', 1, 1.5, 1, 2, 1.5, 3, 1);
`
  const PAYMENTS: Team = { id: PAY, name: 'Payments', source: 'jira', sourceRef: PAY, installedAt: '2026-08-31T09:00:00Z' }
  /** The milestone as the EM entered it after the upgrade. */
  const CHECKOUT: MilestoneInputs = {
    teamId: PAY,
    name: 'Checkout v2',
    startDate: '2026-09-01',
    ticketsRemaining: 40,
    ambiguity: 'medium',
    cadenceDays: 7,
    paceMode: 'range',
    paceRange: { low: 4, high: 8 },
    paceCounts: [],
    paceCadenceDays: 7,
    paceWindow: { action: undefined, skippedPeriods: [] },
    ticketsSource: 'typed',
    seenReads: { ticketsRemaining: undefined, pace: undefined },
  }
  const earlierTables = {
    work_items: 'SELECT id, title FROM work_items ORDER BY rowid',
    milestones: 'SELECT id, name, committed_date FROM milestones',
    milestone_epics: 'SELECT rank, epic_id FROM milestone_epics ORDER BY rank',
    pace_settings: 'SELECT mode, low, high FROM pace_settings',
    workflow_settings: 'SELECT started_status, commit_label, blocked_labels FROM workflow_settings',
    epic_commits: 'SELECT epic_id, committed_at FROM epic_commits',
    epic_ambiguities: 'SELECT epic_id, ambiguity FROM epic_ambiguities',
    medium_measured: 'SELECT medium_measured FROM ambiguity_ranges',
  }

  /** A current file holding the team, with the earlier release's rows written beside it. */
  function preMvpFile(): string {
    const file = fileIn('pre-mvp.db')
    open(file).saveTeam(PAYMENTS)
    closeStorage()
    const earlierRelease = new DatabaseSync(file)
    earlierRelease.exec(EARLIER_RELEASE_ROWS)
    earlierRelease.close()
    return file
  }

  test('reads back its team and ambiguity ranges, and no milestone from the earlier milestone, epics or measured pace', () => {
    const storage = open(preMvpFile())

    expect(storage.teams()).toEqual([PAYMENTS])
    expect(storage.milestoneInputs(PAY)).toBeUndefined()
    expect(storage.ambiguityRanges(PAY)).toEqual({ teamId: PAY, low: { low: 1, high: 1.5 }, medium: { low: 1, high: 2 }, high: { low: 1.5, high: 3 } })
    expect(storage.capacityEntries(PAY)).toEqual([])
  })

  test('is forecast from the milestone entered after the upgrade: its name, tickets and pace, not its epics or committed date', () => {
    const file = preMvpFile()
    open(file).saveMilestoneInputs(CHECKOUT)

    const storage = open(file)
    expect(storage.milestoneInputs(PAY)).toEqual(CHECKOUT)
    const view = milestoneForecastView(storage, PAY, DEFAULT_SETTINGS, '2026-10-24')
    expect(view).toMatchObject({
      kind: 'forecast',
      name: 'Checkout v2',
      ticketsRemaining: 40,
      startDate: '2026-09-01',
      pace: { source: 'range', low: 4, high: 8 },
    })
    expect(JSON.stringify(view)).not.toMatch(/Card vaulting|Refunds|PAY-\d|2026-12-18|committed/i)
  })

  test('takes medium ambiguity for the milestone entered after the upgrade, not the high an epic had before the MVP', () => {
    const storage = open(preMvpFile())
    expect(inputsView(storage, PAY, DEFAULT_SETTINGS, '2026-10-24').milestone.ambiguity).toBe('medium')

    const entered = submitInputs(storage, PAY, DEFAULT_SETTINGS, '2026-10-24', {
      kind: 'setMilestone',
      name: 'Checkout v2',
      startDate: '2026-09-01',
      ticketsRemaining: '40',
    })

    expect(entered).toMatchObject({ saved: true })
    expect(storage.milestoneInputs(PAY)?.ambiguity).toBe('medium')
  })

  test("keeps the earlier release's rows as they were, through saving the MVP's fields and reopening", () => {
    const file = preMvpFile()
    const before = Object.fromEntries(Object.entries(earlierTables).map(([table, sql]) => [table, rowsOf(file, sql)]))

    open(file).saveMilestoneInputs(CHECKOUT)
    open(file).saveAmbiguityRanges({ ...EDITED_RANGES, teamId: PAY })
    open(file).saveCapacityEntries(PAY, [])

    expect(open(file).ambiguityRanges(PAY)).toEqual({ ...EDITED_RANGES, teamId: PAY })
    expect(before.work_items).toEqual([
      { id: 'PAY-1', title: 'Card vaulting' },
      { id: 'PAY-2', title: 'Refunds' },
      { id: 'PAY-11', title: null },
    ])
    expect(before.medium_measured).toEqual([{ medium_measured: 1 }])
    for (const [table, sql] of Object.entries(earlierTables)) expect(rowsOf(file, sql), table).toEqual(before[table])
  })
})
