import { AMBIGUITIES, type AmbiguityRanges, type GrowthRange } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import { PACE_MODES, TICKETS_SOURCES, type MilestoneInputs } from '../model/milestoneInputs.js'
import { TEAM_SOURCES, type Team } from '../model/team.js'
import { isPaceCounts, isStoredPaceWindow, isStoredSeenReads } from './lib/milestoneInputsJson.js'
import { isListOf, isNumber, isObject, isOneOf, isRecordOf, isString, optional } from './lib/storedJson.js'
import { webLedger } from './lib/webLedger.js'
import { held, readKey, writeKey, type KeyValueStore } from './lib/webStore.js'
import type { Storage } from './storage.js'

export type { KeyValueStore } from './lib/webStore.js'

/** Where the data is kept in the browser's storage: everything but the forecast ledger, as one JSON value. */
const KEY = 'forecaster'

/** Everything stored, by team ID. Fields are added, or dropped as read, so data from an earlier build still reads. */
interface Stored {
  teams: Team[]
  /**
   * Each team's milestone inputs, missing the fields added since the build that stored them: the pace window (#161),
   * or sources, skips and reads seen (#210). A build before #409 kept the cadence the pace was entered in too, which
   * reading drops: a milestone has one cadence.
   */
  milestoneInputs: Record<
    string,
    Omit<MilestoneInputs, 'paceWindow' | 'ticketsSource' | 'seenReads'> & {
      paceWindow?: Partial<MilestoneInputs['paceWindow']>
      ticketsSource?: MilestoneInputs['ticketsSource']
      seenReads?: Partial<MilestoneInputs['seenReads']>
      paceCadenceDays?: unknown
    }
  >
  ambiguityRanges: Record<string, AmbiguityRanges>
  /** Each team's capacity entries; an entry running onward has no `to`. */
  capacityEntries: Record<string, CapacityEntry[]>
  /** The teams whose capacity is switched off; a team not here has it on. */
  capacityOff: string[]
}

/**
 * The web build's Storage: the EM's own data, in their browser (#114). Each save writes it all back to `store`.
 * When the browser gives no storage, or refuses it (a private window, blocked site data), this starts empty and keeps
 * what is saved only until the page closes. When it holds data this version can't read (text that isn't JSON, or JSON
 * of a shape it doesn't know, left by a later build, say), every read and save throws, naming the key, as the SQLite
 * file refuses a column it can't read, so what is there is kept. Data it can read keeps no field it doesn't know: the
 * next save drops it. The forecast ledger is kept apart (`webLedger`), so neither refuses or crowds out the other.
 */
export function openWebStorage(store: KeyValueStore | undefined): Storage {
  const empty: Stored = { teams: [], milestoneInputs: {}, ambiguityRanges: {}, capacityEntries: {}, capacityOff: [] }
  const kept = readKey(store, KEY, isStored, { empty })
  /** What is stored, or the refusal of data this version can't read. */
  const stored = (): Stored => held(kept)
  const write = (): void => writeKey(store, KEY, JSON.stringify(stored()))

  return {
    ...webLedger(store),

    isEmpty() {
      return stored().teams.length === 0
    },

    saveTeam(team) {
      const { teams } = stored()
      const index = teams.findIndex((each) => each.id === team.id)
      if (index === -1) teams.push(team)
      else teams[index] = { ...team, installedAt: teams[index]!.installedAt }
      write()
    },

    teams() {
      return structuredClone(stored().teams)
    },

    saveMilestoneInputs(inputs) {
      stored().milestoneInputs[inputs.teamId] = structuredClone(inputs)
      write()
    },

    milestoneInputs(teamId) {
      const inputs = stored().milestoneInputs[teamId]
      return inputs && structuredClone(withDefaults(inputs))
    },

    saveAmbiguityRanges(ranges) {
      stored().ambiguityRanges[ranges.teamId] = structuredClone(ranges)
      write()
    },

    ambiguityRanges(teamId) {
      const ranges = stored().ambiguityRanges[teamId]
      return ranges && structuredClone(ranges)
    },

    saveCapacityEntries(teamId, entries) {
      stored().capacityEntries[teamId] = structuredClone([...entries])
      write()
    },

    capacityEntries(teamId) {
      // JSON drops an undefined `to`, so an onward entry reads back without one
      return (stored().capacityEntries[teamId] ?? []).map((entry) => ({ ...entry, to: entry.to ?? undefined }))
    },

    saveCapacityOn(teamId, on) {
      const data = stored()
      data.capacityOff = [...data.capacityOff.filter((id) => id !== teamId), ...(on ? [] : [teamId])]
      write()
    },

    capacityOn(teamId) {
      return !stored().capacityOff.includes(teamId)
    },

    close() {},
  }
}

/**
 * The milestone inputs, with what an earlier build didn't store at its default: no action and no skips, tickets typed,
 * nothing seen; and without the cadence a pace was entered in, which an earlier build kept. JSON drops an undefined
 * `readAt`, so it is read back as undefined.
 */
function withDefaults({ paceWindow, ticketsSource, seenReads, paceCadenceDays: _, ...inputs }: Stored['milestoneInputs'][string]): MilestoneInputs {
  return {
    ...inputs,
    ticketsSource: ticketsSource ?? 'typed',
    paceWindow: { action: paceWindow?.action, skippedPeriods: paceWindow?.skippedPeriods ?? [] },
    seenReads: { ticketsRemaining: seenReads?.ticketsRemaining, pace: seenReads?.pace },
  }
}

const isTeam = (value: unknown): value is Team =>
  isObject(value) && ['id', 'name', 'sourceRef', 'installedAt'].every((field) => isString(value[field])) && isOneOf(TEAM_SOURCES)(value.source)

/** A low–high range, as each one stored is: an ambiguity level's growth, or a pace's, the same shape. */
const isRange = (value: unknown): value is GrowthRange => isObject(value) && isNumber(value.low) && isNumber(value.high)

/** A team's milestone inputs, as an earlier build may have stored them (`Stored`). */
const isStoredMilestoneInputs = (value: unknown): value is Stored['milestoneInputs'][string] =>
  isObject(value) &&
  isString(value.teamId) &&
  isString(value.name) &&
  optional(isString)(value.startDate) &&
  optional(isNumber)(value.ticketsRemaining) &&
  optional(isOneOf(TICKETS_SOURCES))(value.ticketsSource) &&
  isOneOf(AMBIGUITIES)(value.ambiguity) &&
  isNumber(value.cadenceDays) &&
  isOneOf(PACE_MODES)(value.paceMode) &&
  optional(isRange)(value.paceRange) &&
  isPaceCounts(value.paceCounts) &&
  optional(isStoredPaceWindow)(value.paceWindow) &&
  optional(isStoredSeenReads)(value.seenReads)

const isAmbiguityRanges = (value: unknown): value is AmbiguityRanges =>
  isObject(value) && isString(value.teamId) && AMBIGUITIES.every((level) => isRange(value[level]))

/** A capacity entry as stored: JSON drops an undefined `to`. */
const isCapacityEntry = (value: unknown): value is CapacityEntry =>
  isObject(value) &&
  isNumber(value.id) &&
  isString(value.from) &&
  optional(isString)(value.to) &&
  isNumber(value.percent) &&
  isString(value.note) &&
  optional(isString)(value.newUsualOn) &&
  optional(isOneOf([true] as const))(value.kept)

/**
 * Everything stored, as reading it needs: an object whose parts, each missing in data from an earlier build, are the
 * teams, each team's records by its ID, and the IDs of the teams with capacity off.
 */
function isStored(value: unknown): value is Partial<Stored> {
  if (!isObject(value)) return false
  const { teams, milestoneInputs, ambiguityRanges, capacityEntries, capacityOff } = value
  return (
    optional(isListOf(isTeam))(teams) &&
    optional(isRecordOf(isStoredMilestoneInputs))(milestoneInputs) &&
    optional(isRecordOf(isAmbiguityRanges))(ambiguityRanges) &&
    optional(isRecordOf(isListOf(isCapacityEntry)))(capacityEntries) &&
    optional(isListOf(isString))(capacityOff)
  )
}
