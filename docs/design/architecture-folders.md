# Architecture: Folder structure

Part of the architecture design; the index is [`architecture.md`](architecture.md).

The tree is `src/` as it stands in the MVP, with `connectors/` and `secrets/`. v1 adds `samples/` (Layer 2: commits, throughput, growth and epic-size samples derived from `model/`) and the deleted epic-era files (work items, workflow settings, epic commits, team facts, measured pace and growth), which [`forecast-model-facts.md`](forecast-model-facts.md) describes, and `ledger/` (Layer 5), which [`forecast-model.md`](forecast-model.md) describes.

```
src/
  model/                  # Layer 1: record types, no logic
    team.ts
    milestoneInputs.ts    # MilestoneInputs: what the EM types in for the team's milestone; PaceMode, TicketsSource, the skipped periods and reads seen
    ambiguity.ts          # Ambiguity and AmbiguityRanges: set by the EM
    connection.ts         # Connection: the team's one tracker and repo or Jira project (with Jira's account email); never a token

  engine/                 # pure: no I/O, no DB, no clock; see src/engine/ for its files
    index.ts              # exports simulateCase, periodEndDate and the types only

  forecast/               # the only module that knows both stored data and the engine
    inputs.ts             # Seam B: stored data → the Inputs screen's view; a submitted form saved (and where next) or refused (and the screen to show again)
    milestoneInputs.ts    # behind inputs.ts: the milestone's view and edits
    milestoneAssessment.ts  # behind both views: the milestone's inputs against the settings and today, with the pace in use: what stops a forecast, the warnings, the pace the forecast runs on
    trackerReads.ts       # behind both views: what the tracker measures from its saved reads: tickets remaining (through queryRead.ts), and the milestone's pace through lib/pace.ts
    lib/pace.ts           # the pace module, `paceOf`: the only place pace is worked out, and the only import pace's callers use; tested only through Seam B
    lib/periodCounts.ts   # behind lib/pace.ts: the saved reads pace is measured from, their finished tickets counted per period side by side in the EM's time zone
    lib/trackerWindow.ts  # behind lib/pace.ts: the tracker's pace window, the skipped periods it reaches back past, and what its bound says
    lib/paceReading.ts    # behind lib/pace.ts: the tracker's reading of pace, and the pace the latest read replaced
    lib/paceInUse.ts      # behind lib/pace.ts: the pace in use, from the source the EM chose, and its notes
    growth.ts             # behind inputs.ts: the ambiguity ranges view and edit; the milestone's growth range
    connection.ts         # Seam B: the Connect step's view; a connect checked through a connector from a factory passed in, then saved (with its token, through secrets/) or refused; disconnect; a failing keychain or data file refused, changing nothing
    trackers.ts           # each tracker's facts: its name, its token's permission, where a connection reads, its form and what it lacks, its refusals
    milestoneForecastView.ts  # Seam B: stored data → the Milestone forecast screen's view, through the engine
    settings.ts           # ForecastSettings and AmbiguityRanges defaults
    appVersion.ts         # the app's version, `APP_VERSION`, imported from `package.json` with no file read: the release a merge to main is tagged as, in every screen's footer, and importable where a forecast is made, beside the engine's
    cadence.ts            # what the screens call a period: a week or a sprint
    calendarDate.ts       # ISO calendar dates: checking and counting days between
    counted.ts            # a count with its words: "1 ticket", "40 tickets"
    editResult.ts         # an edit saved, or refused saying why
    skippedPeriods.ts     # Seam B: the tracker's periods skipped or counted again, read further back where a skip needs it
    setup.ts              # Seam B: the setup steps, Connect → Milestone → Comparable work → Check, one at a time; closed with "Use these" to a summary, or skipped to the inputs typed; Change opens them again; Cancel, refused once the steps changed the connection; one SetupContext
    setupSteps.ts         # the four setup steps in order, and the step a URL asks for
    setupSummary.ts       # setup's summary view: its rows, their picks' counts and note, and problem flags
    setupReads.ts         # Seam B: setup's reads: each pick read at Check for its count (`readPicks`, from `openSetup`), Read again, why a read failed
    queryRead.ts          # reading a query and saving the read, how far back a read reaches (finishedSince, the tracker's periods), whether it is complete, its tickets remaining and weeks read; tested through Seam B
    queryStep.ts          # Seam B: a query step's view, whole (the Milestone step, or the Comparable work step with its pace and candidates); its searched choices; its submits
    lib/choiceLists.ts    # behind queryStep.ts: each kind's choices as the picker lists them, filtered here or searched in the tracker
    lib/stepQueryEdit.ts  # behind queryStep.ts: the query an edit makes, its picks changed or typed by hand and read back into chips
    lib/readSaid.ts       # behind queryStep.ts: what a step says of its query's read (its line and flag), and why the tracker rejected the query
    stepQuery.ts          # which of the team's queries a query step edits: the milestone query, or comparable work's
    candidates.ts         # Seam B: comparable work's candidates, read on demand in an opening
    milestoneRenamed.ts   # Seam B: the milestone query following the milestone to its new name

  connectors/             # what reads the team's tickets from its tracker; everything tracker-specific stays inside one
    connector.ts          # the interface and its shared types: Ticket, Failure, ReadResult, Choice, ChoicesOfKind; a connector takes its Connection from `model/`
    remote.ts             # what the network connectors share: sending a request (only a network failure is unavailable), status to failure, the scope check, the finishedSince filter
    canned.ts             # the canned connector's entry point: its factory, its fixture's type and demo mode's connector; outside code imports this, never canned/
    github.ts             # the GitHub connector's entry point: its factory; outside code imports this, never github/
    jira.ts               # the Jira connector's entry point: its factory; outside code imports this, never jira/
    canned/               # the canned connector, answering from a fixture in the connector's own shape; Seam B tests use it
      demo.ts             # demo mode's connector: the synthetic fixture, refusing the token `refused` and a repo or project named `unknown`
      demoFixture.json    # demo mode's synthetic fixture: made up, no real team's data
    github/               # the GitHub connector
    jira/                 # the Jira Cloud connector

  secrets/                # the team's tracker token, keyed by team; the local server build only
    secrets.ts            # the interface: save, read and delete a team's token
    keychainSecrets.ts    # the OS keychain, through @napi-rs/keyring; its errors never quote the token
    memorySecrets.ts      # in memory: the fake Seam B tests use

  storage/                # interface and its v1 SQLite file, with the schema's migrations; the web build's browser storage
    sqliteStorage.ts      # the SQLite file: the schema's steps (MIGRATIONS), opening and migrating it, its parts in lib/ put together
    lib/sqliteDatabase.ts # behind sqliteStorage.ts: the open SQLite file, its rows, and a transaction over it
    lib/teamTables.ts     # behind sqliteStorage.ts: the teams, each team's milestone inputs, ambiguity ranges and capacity
    lib/connectionTable.ts # behind sqliteStorage.ts: the team's connection
    lib/savedReadTables.ts # behind sqliteStorage.ts: each query's last read and previous read, with their tickets
    lib/milestoneQueryTables.ts # behind sqliteStorage.ts: the milestone query and comparable work's, and the picks as a row keeps them
    lib/setupTables.ts    # behind sqliteStorage.ts: where setup stands, the setup draft's rows, and why the last reads failed
    lib/setupDraft.ts     # behind sqliteStorage.ts: the team's queries and reads in each target, the setup draft over what's saved; the draft's fields saved; "Use these" applying it
  app/                    # local server (localhost only), screens, `npm start` entry point; each screen's HTML, and reading the fields of the forms it posts; the web build's app and page script (`webApp.ts`, `webMain.ts`); the stylesheet every page shares (`html.ts`), each screen's styles in `lib/`; the app's version (`forecast/appVersion.ts`'s `APP_VERSION`) in every screen's footer and streamed on the server's `/live`, which each page it serves listens on to reload when the version changes (the web build's pages don't)

test/
  app/                    # the screens, launch, and the launch smoke test: start the app, check the screen is served; the web build's app and its smoke test
  engine/                 # Seam A: fixed seeds, plus a performance benchmark
  forecast/               # Seam B: stored inputs + settings → the screens' views
  connectors/             # Seam C: the connector contract suite, its replay transport, the backoff tests' stand-in tracker and waits, and the scenarios and queries recorded for it; each tracker's quirks and recordings in its own folder; the canned connector
  secrets/                # the Secrets contract, run against the in-memory fake and the OS keychain (where one answers); no error quotes the token
  storage/                # the schema's migrations; the Storage contract, run against SQLite and browser storage
  dependencyRules.test.ts # the dependency rules (architecture-dependency-rules.md) that keep connectors/ and secrets/ at the edge
  testSeams.test.ts       # each test folder imports only its seam's entry points (architecture-test-seams.md): TEST_SEAMS, the one list
  importScan.ts           # reading what files import, for the two tests above
```
