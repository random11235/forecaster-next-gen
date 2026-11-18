import type { Ambiguity } from '../../src/model/ambiguity.js'
import type { Connection } from '../../src/model/connection.js'
import type { PaceAction, PaceMode, TicketsSource } from '../../src/model/milestoneInputs.js'
import type { MilestoneQuery } from '../../src/model/milestoneQuery.js'
import type { FailedRead } from '../../src/model/readFailures.js'
import type { Team } from '../../src/model/team.js'
import type { SqliteStorage } from '../../src/storage/sqliteStorage.js'
import type { SetupClosed, SetupState, Storage } from '../../src/storage/storage.js'

// Every union whose values reach storage, each its values as a record, so the typecheck fails on a value missing or
// one the union doesn't have. The checks below fail it on a stored union not listed, one listed but not stored, or one
// listed `web` wrongly.

/** Every value of `T`, each `true`: a value missing, or one `T` doesn't have, fails the typecheck. */
type Values<T extends string> = Record<T, true>

/** Each union whose values reach storage, by name: its values, and whether the web build's storage keeps it too. */
export const STORED_UNIONS = {
  'Team.source': { values: { manual: true, sample: true, jira: true, github: true } satisfies Values<Team['source']>, web: true },
  Ambiguity: { values: { low: true, medium: true, high: true } satisfies Values<Ambiguity>, web: true },
  PaceMode: { values: { range: true, counts: true, tracker: true } satisfies Values<PaceMode>, web: true },
  TicketsSource: { values: { tracker: true, typed: true } satisfies Values<TicketsSource>, web: true },
  'PaceAction.kind': { values: { startFrom: true, leaveOut: true } satisfies Values<PaceAction['kind']>, web: true },
  'Connection.tracker': { values: { github: true, jira: true } satisfies Values<Connection['tracker']>, web: false },
  'Choice.kind': {
    values: { epic: true, label: true, milestone: true, fixVersion: true } satisfies Values<MilestoneQuery['picks'][number]['kind']>,
    web: false,
  },
  SetupClosed: { values: { done: true, skipped: true } satisfies Values<SetupClosed>, web: false },
  'SetupState.connection': {
    values: { made: true, changed: true } satisfies Values<NonNullable<Extract<SetupState, { open: true }>['connection']>>,
    web: false,
  },
  'FailedRead.failure': {
    values: {
      invalidQuery: true,
      outOfScope: true,
      notFound: true,
      unauthorised: true,
      unavailable: true,
      keychainFailed: true,
    } satisfies Values<FailedRead['failure']>,
    web: false,
  },
} as const

/** `T`'s string literals: none for `string` itself. */
type Literals<T> = T extends string ? (string extends T ? never : T) : never
/** The elements of `T`'s arrays and tuples. */
type Elements<T> = T extends readonly (infer E)[] ? E : never
/** `T`'s objects that aren't arrays. */
type Records<T> = T extends readonly unknown[] ? never : T extends object ? T : never
/** Every key any of `T`'s members has. */
type KeysOf<T> = T extends unknown ? keyof T : never
/** Field `K` of whichever of `T`'s members has it. */
type FieldOf<T, K extends PropertyKey> = T extends unknown ? (K extends keyof T ? T[K] : never) : never

/** Each string-literal union a value of type `T` holds, a tuple each: its own, and its elements' and fields', all the way down. */
type UnionsIn<T> =
  | ([Literals<T>] extends [never] ? never : [Literals<T>])
  | ([Elements<T>] extends [never] ? never : UnionsIn<Elements<T>>)
  | { [K in KeysOf<Records<T>>]-?: UnionsIn<FieldOf<Records<T>, K>> }[KeysOf<Records<T>>]

/** Each union a storage's `save…` methods take, so stores: a tuple each. */
type StoredBy<S> = UnionsIn<{ [K in keyof S as K extends `save${string}` ? K : never]: S[K] extends (...args: infer A) => unknown ? A : never }>

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
/** Whether one of the `Unions` tuples is `[U]`. */
type Has<Unions, U> = true extends (Unions extends [infer V] ? Same<V, U> : never) ? true : false
/** True when `T` is never, else `T`, under `fix`, which a failing check shows. */
type Check<T, Fix extends string> = [T] extends [never] ? true : { [_ in Fix]: T }
type Assert<T extends true> = T

type Listed = typeof STORED_UNIONS
type ListedUnions = { [N in keyof Listed]: [keyof Listed[N]['values']] }[keyof Listed]
type Unlisted = StoredBy<SqliteStorage> extends infer U ? (U extends [infer V] ? (Has<ListedUnions, V> extends true ? never : V) : never) : never
type Unstored = { [N in keyof Listed]: Has<StoredBy<SqliteStorage>, keyof Listed[N]['values']> extends true ? never : N }[keyof Listed]
type WebWrong = { [N in keyof Listed]: Has<StoredBy<Storage>, keyof Listed[N]['values']> extends Listed[N]['web'] ? never : N }[keyof Listed]

export type EveryStoredUnionListed = Assert<Check<Unlisted, 'stored, so list its union in STORED_UNIONS, and its values in storedValues.snapshot'>>
export type EveryListedUnionStored = Assert<Check<Unstored, 'listed but not stored, as these values: list the union storage stores'>>
export type WebSaysWhetherTheWebBuildKeepsIt = Assert<Check<WebWrong, "listed with `web` wrong: true when the web build's Storage stores it">>
