# Architecture: Storage tests

Part of the test seams; see [`architecture-test-seams.md`](architecture-test-seams.md), whose index is [`architecture.md`](architecture.md).

## Storage contract

`test/storage/` holds the Storage contract: one suite, run against both the SQLite file and the web build's browser storage.

- **SQLite-only cases.** The team's connection, the last read of each query, the milestone's picks and query, and its setup (`ConnectionStorage`, `SavedReadStorage`, `MilestoneQueryStorage` and `SetupStorage`, part of `openSqliteStorage`'s `SqliteStorage`) are kept only by the SQLite file, so their cases run against SQLite alone: the browser build has no connectors.
- **Two targets.** The team's queries and reads come in two targets (`TeamQueryStorage.teamQueries`): `current`, the setup draft over what's saved while setup is open, which the setup steps read and save; and `saved`, which the forecast reads. Applying the draft ("Use these", `applySetupDraft`), discarding it (Cancel, `discardSetupDraft`), and saving its sources and picks' failures (`saveDraftSources`, `saveDraftPickFailures`) are storage operations. The draft over what's saved (`src/storage/lib/setupDraft.ts`, behind `sqliteStorage.ts`) is tested only through the contract, with setup open and closed.
- **Stored JSON** is read only through `parseStored` in `src/storage/lib/storedJson.ts`; `test/storedJsonRules.test.ts` fails on any other use of the `JSON` global but `JSON.stringify` in `src/storage/`.
- **Data storage can't write.** The contract's cases for stored data it can't read (`storageContract.storedShape.test.ts`, against both storages) and for values from a later version (`storageContract.unknownValues.test.ts`) write that data straight in, each storage seeded its own way (SQLite through `test/storage/sqliteStraight.ts`); so does Seam B's test of a logged result it can't read (`test/forecast/forecastLedger.unreadableResult.test.ts`). Every other test arranges through storage's own functions, and `test/arrangeRules.test.ts` fails on SQL or the database opened directly in any test file but the exceptions it lists.

## Migration tests

The migration tests are not a forecasting seam either: they write a data file as an earlier release left it, open it through `openSqliteStorage`, and check what reads back, through storage or through Seam B's views.

A branch into main that changes the schema appends at most one step to `MIGRATIONS` in `src/storage/sqliteStorage.ts`, never editing a released one. Tickets on an integration branch extend that branch's one unreleased step rather than appending their own. The step's test, in a `test/storage/migrations.*.test.ts`:

- names its step in a plain `describe('step N: …')` at the top level of its file, at column 0 (`test/storage/migrationStep.ts` holds the label);
- arranges through the harness (`migrationsHarness.ts`), writing a data file at version N - 1 (step 1's, from before schema versions, at 0);
- runs plainly, one test at a time: no `skip`, `todo`, `only`, `skipIf`, `runIf`, `concurrent` or `fails`, in any form.

`test/storage/migrationCoverage.test.ts` fails, naming the step and the file, on a test that breaks these, and its header says why each holds. `migrations.beforeTheMvp.test.ts` names no step on purpose: its file is at the current version. `npm run check:migrations` (part of `npm run check`, so of the pre-push hook and CI) checks the step rules against main.

## Stored values

The values of every union that reaches storage are frozen by a snapshot, `test/storage/storedValues.snapshot`. `storedUnions.ts` lists the unions, each with the columns that store it, bound to their types by the typecheck, which also fails on a union a storage's `save…` method takes that isn't listed. A union the SQLite file writes that no `save…` method takes (`read_failures.of`) is typed in `storedUnions.ts`'s `SqliteEncodings` instead, and `storageContract.storedValues.test.ts` checks the file writes and reads back exactly its listed values.

`storedValues.test.ts` diffs the snapshot against released main (`MAIN_REF`, origin/main, as the migration check; never `CHECK_BASE`, since only released values can be in saved data). A value a column no longer stores fails it, unless a migration step on the branch maps it in that column and, for a union the web build keeps, `webStorage.ts` still names it. A union only renamed, its values stored where they were, needs no migration. Two limits are known: the web build's storage has no columns, and its code naming a value at all counts as mapping it, for every union that has it; and a statement is on a column when it names the table and the column anywhere, a subquery included.
