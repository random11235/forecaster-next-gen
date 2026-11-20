import type { DatabaseSync } from 'node:sqlite'
import type { Ambiguity, AmbiguityRanges } from '../../model/ambiguity.js'
import type { CapacityEntry } from '../../model/capacity.js'
import type { MilestoneInputs, PaceMode, PaceWindow, SeenReads, TicketsSource } from '../../model/milestoneInputs.js'
import type { Team } from '../../model/team.js'
import type { Ledger } from '../../ledger/ledger.js'
import type { Storage } from '../storage.js'
import type { Row, Transaction } from './sqliteDatabase.js'
import { isPaceCounts, isStoredPaceWindow, isStoredSeenReads } from './milestoneInputsJson.js'
import { parseStored } from './storedJson.js'

/*
 * The team and its milestone's inputs in the SQLite file, behind sqliteStorage.ts: the teams, each team's milestone
 * inputs, ambiguity ranges and capacity, as every Storage keeps them.
 */

/** What every Storage keeps, in the SQLite file `db`, but closing it. */
export function teamTables(db: DatabaseSync, transaction: Transaction): Omit<Storage, 'close' | keyof Ledger> {
  const upsertTeam = db.prepare(`
    INSERT INTO teams (id, name, source, source_ref, installed_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET name = excluded.name, source = excluded.source, source_ref = excluded.source_ref`)
  const upsertMilestoneInputs = db.prepare(`
    INSERT INTO milestone_inputs
      (team_id, name, start_date, tickets_remaining, ambiguity, cadence_days, pace_mode, pace_low, pace_high, pace_counts,
       pace_cadence_days, pace_window, tickets_source, seen_reads)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (team_id) DO UPDATE SET
      name = excluded.name, start_date = excluded.start_date, tickets_remaining = excluded.tickets_remaining,
      ambiguity = excluded.ambiguity, cadence_days = excluded.cadence_days, pace_mode = excluded.pace_mode,
      pace_low = excluded.pace_low, pace_high = excluded.pace_high, pace_counts = excluded.pace_counts,
      pace_cadence_days = excluded.pace_cadence_days, pace_window = excluded.pace_window,
      tickets_source = excluded.tickets_source, seen_reads = excluded.seen_reads`)
  const selectMilestoneInputs = db.prepare('SELECT * FROM milestone_inputs WHERE team_id = ?')
  // medium_measured is left as it is: nothing reads it since measured growth went with the MVP (#84)
  const upsertAmbiguityRanges = db.prepare(`
    INSERT INTO ambiguity_ranges (team_id, low_low, low_high, medium_low, medium_high, high_low, high_high, medium_measured)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT (team_id) DO UPDATE SET
      low_low = excluded.low_low, low_high = excluded.low_high, medium_low = excluded.medium_low,
      medium_high = excluded.medium_high, high_low = excluded.high_low, high_high = excluded.high_high`)
  const selectAmbiguityRanges = db.prepare('SELECT * FROM ambiguity_ranges WHERE team_id = ?')
  const deleteCapacityEntries = db.prepare('DELETE FROM capacity_entries WHERE team_id = ?')
  const insertCapacityEntry = db.prepare(
    'INSERT INTO capacity_entries (team_id, id, from_date, to_date, percent, note, new_usual_on, kept) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const selectCapacityEntries = db.prepare('SELECT * FROM capacity_entries WHERE team_id = ? ORDER BY rowid')
  const upsertCapacitySwitch = db.prepare(
    'INSERT INTO capacity_switch (team_id, capacity_on) VALUES (?, ?) ON CONFLICT (team_id) DO UPDATE SET capacity_on = excluded.capacity_on',
  )
  const selectCapacitySwitch = db.prepare('SELECT capacity_on FROM capacity_switch WHERE team_id = ?')

  return {
    isEmpty() {
      return db.prepare('SELECT 1 FROM teams LIMIT 1').get() === undefined
    },

    saveTeam(team) {
      upsertTeam.run(team.id, team.name, team.source, team.sourceRef, team.installedAt)
    },

    teams() {
      return db
        .prepare('SELECT id, name, source, source_ref, installed_at FROM teams ORDER BY rowid')
        .all()
        .map((row: Row) => ({
          id: String(row.id),
          name: String(row.name),
          source: String(row.source) as Team['source'],
          sourceRef: String(row.source_ref),
          installedAt: String(row.installed_at),
        }))
    },

    saveMilestoneInputs(inputs) {
      upsertMilestoneInputs.run(
        inputs.teamId,
        inputs.name,
        inputs.startDate ?? null,
        inputs.ticketsRemaining ?? null,
        inputs.ambiguity,
        inputs.cadenceDays,
        inputs.paceMode,
        inputs.paceRange?.low ?? null,
        inputs.paceRange?.high ?? null,
        JSON.stringify(inputs.paceCounts),
        inputs.paceCadenceDays ?? null,
        JSON.stringify(inputs.paceWindow),
        inputs.ticketsSource,
        JSON.stringify(inputs.seenReads),
      )
    },

    milestoneInputs(teamId) {
      const row = selectMilestoneInputs.get(teamId)
      if (row === undefined) return undefined
      return {
        teamId: String(row.team_id),
        name: String(row.name),
        startDate: row.start_date === null ? undefined : String(row.start_date),
        ticketsRemaining: row.tickets_remaining === null ? undefined : Number(row.tickets_remaining),
        ambiguity: String(row.ambiguity) as Ambiguity,
        cadenceDays: Number(row.cadence_days),
        paceMode: String(row.pace_mode) as PaceMode,
        paceRange: row.pace_low === null ? undefined : { low: Number(row.pace_low), high: Number(row.pace_high) },
        paceCounts: parseStored(String(row.pace_counts), 'milestone_inputs.pace_counts', isPaceCounts),
        paceCadenceDays: row.pace_cadence_days === null ? undefined : Number(row.pace_cadence_days),
        paceWindow: paceWindowOf(String(row.pace_window)),
        ticketsSource: String(row.tickets_source) as TicketsSource,
        seenReads: seenReadsOf(String(row.seen_reads)),
      } satisfies MilestoneInputs
    },

    saveAmbiguityRanges(ranges) {
      upsertAmbiguityRanges.run(ranges.teamId, ranges.low.low, ranges.low.high, ranges.medium.low, ranges.medium.high, ranges.high.low, ranges.high.high)
    },

    ambiguityRanges(teamId) {
      const row = selectAmbiguityRanges.get(teamId)
      if (row === undefined) return undefined
      const range = (level: string) => ({ low: Number(row[`${level}_low`]), high: Number(row[`${level}_high`]) })
      return {
        teamId: String(row.team_id),
        low: range('low'),
        medium: range('medium'),
        high: range('high'),
      } satisfies AmbiguityRanges
    },

    saveCapacityEntries(teamId, entries) {
      transaction(() => {
        deleteCapacityEntries.run(teamId)
        for (const entry of entries) {
          insertCapacityEntry.run(teamId, entry.id, entry.from, entry.to ?? null, entry.percent, entry.note, entry.newUsualOn ?? null, entry.kept ? 1 : 0)
        }
      })
    },

    capacityEntries(teamId) {
      return selectCapacityEntries.all(teamId).map(
        (row: Row) =>
          ({
            id: Number(row.id),
            from: String(row.from_date),
            to: row.to_date === null ? undefined : String(row.to_date),
            percent: Number(row.percent),
            note: String(row.note),
            ...(row.new_usual_on !== null && { newUsualOn: String(row.new_usual_on) }),
            ...(Number(row.kept) === 1 && { kept: true as const }),
          }) satisfies CapacityEntry,
      )
    },

    saveCapacityOn(teamId, on) {
      upsertCapacitySwitch.run(teamId, on ? 1 : 0)
    },

    capacityOn(teamId) {
      const row = selectCapacitySwitch.get(teamId)
      return row === undefined || Number(row.capacity_on) === 1
    },
  }
}

/** The pace window as saved: a file from before #161 has no action, and one from before #210 no skipped periods. */
function paceWindowOf(json: string): PaceWindow {
  const { action, skippedPeriods } = parseStored(json, 'milestone_inputs.pace_window', isStoredPaceWindow)
  return { action, skippedPeriods: skippedPeriods ?? [] }
}

/** The reads seen as saved: JSON drops an undefined `readAt`, and a file from before #210 has seen none. */
function seenReadsOf(json: string): SeenReads {
  const { ticketsRemaining, pace } = parseStored(json, 'milestone_inputs.seen_reads', isStoredSeenReads)
  return { ticketsRemaining, pace }
}
