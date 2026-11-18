import { AMBIGUITIES, type AmbiguityRanges } from '../model/ambiguity.js'
import type { CapacityEntry } from '../model/capacity.js'
import { PACE_MODES, type MilestoneInputs, type TicketsSource } from '../model/milestoneInputs.js'
import type { Team } from '../model/team.js'
import { isPaceCounts, isStoredPaceWindow, isStoredSeenReads } from './lib/milestoneInputsJson.js'
import { isListOf, isNumber, isObject, isOneOf, isRecordOf, isString, optional, parseStored } from './lib/storedJson.js'
import type { Storage } from './storage.js'

/** The part of the browser's `localStorage` this uses: strings by key. */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Where the data is kept in the browser's storage: everything, as one JSON value. */
const KEY = 'forecaster'

/** Everything stored, by team ID. Fields are only ever added, so data from an earlier build still reads. */
interface Stored {
  teams: Team[]
  /**
   * Each team's milestone inputs, missing the fields added since the build that stored them: the pace window (#161),
   * or sources, skips and reads seen (#210).
   */
  milestoneInputs: Record<
    string,
    Omit<MilestoneInputs, 'paceWindow' | 'ticketsSource' | 'seenReads'> & {
      paceWindow?: Partial<MilestoneInputs['paceWindow']>
      ticketsSource?: MilestoneInputs['ticketsSource']
      seenReads?: Partial<MilestoneInputs['seenReads']>
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
 * file refuses a column it can't read, so what is there is never written over.
 */
export function openWebStorage(store: KeyValueStore | undefined): Storage {
  const kept = read(store)
  /** What is stored, or the refusal of data this version can't read. */
  const stored = (): Stored => {
    if (kept instanceof Error) throw kept
    return kept
  }
  const write = (): void => {
    try {
      store?.setItem(KEY, JSON.stringify(stored()))
    } catch {
      // kept in memory only, until the page closes
    }
  }

  return {
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
 * nothing seen. JSON drops an undefined `readAt`, so it is read back as undefined.
 */
function withDefaults({ paceWindow, ticketsSource, seenReads, ...inputs }: Stored['milestoneInputs'][string]): MilestoneInputs {
  return {
    ...inputs,
    ticketsSource: ticketsSource ?? 'typed',
    paceWindow: { action: paceWindow?.action, skippedPeriods: paceWindow?.skippedPeriods ?? [] },
    seenReads: { ticketsRemaining: seenReads?.ticketsRemaining, pace: seenReads?.pace },
  }
}

/** What `store` holds: empty when it holds nothing or the browser refuses it, and the refusal when it can't be read. */
function read(store: KeyValueStore | undefined): Stored | Error {
  const empty: Stored = { teams: [], milestoneInputs: {}, ambiguityRanges: {}, capacityEntries: {}, capacityOff: [] }
  let json: string | null | undefined
  try {
    json = store?.getItem(KEY)
  } catch {
    return empty
  }
  if (json === null || json === undefined) return empty
  try {
    return { ...empty, ...parseStored(json, `browser storage's "${KEY}"`, isStored) }
  } catch (refused) {
    return refused as Error
  }
}

const isTeam = (value: unknown): value is Team =>
  isObject(value) &&
  ['id', 'name', 'sourceRef', 'installedAt'].every((field) => isString(value[field])) &&
  isOneOf<Team['source']>(['manual', 'sample', 'jira', 'github'])(value.source)

const isRange = (value: unknown): value is { low: number; high: number } => isObject(value) && isNumber(value.low) && isNumber(value.high)

/** A team's milestone inputs, as an earlier build may have stored them (`Stored`). */
const isStoredMilestoneInputs = (value: unknown): value is Stored['milestoneInputs'][string] =>
  isObject(value) &&
  isString(value.teamId) &&
  isString(value.name) &&
  optional(isString)(value.startDate) &&
  optional(isNumber)(value.ticketsRemaining) &&
  optional(isOneOf<TicketsSource>(['tracker', 'typed']))(value.ticketsSource) &&
  isOneOf(AMBIGUITIES)(value.ambiguity) &&
  isNumber(value.cadenceDays) &&
  isOneOf(PACE_MODES)(value.paceMode) &&
  optional(isRange)(value.paceRange) &&
  isPaceCounts(value.paceCounts) &&
  optional(isNumber)(value.paceCadenceDays) &&
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
