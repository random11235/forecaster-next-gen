# Architecture: Folder structure

Part of the architecture design; the index is [`architecture.md`](architecture.md).

The tree is `src/` as it stands in the MVP, with `connectors/` and `secrets/`. v1 adds `samples/` (Layer 2: commits, throughput, growth and epic-size samples derived from `model/`) and the deleted epic-era files (work items, workflow settings, epic commits, team facts, measured pace and growth), which [`forecast-model-facts.md`](forecast-model-facts.md) describes, and the rest of `ledger/` (Layer 5: outcomes and scores), which [`forecast-model.md`](forecast-model.md) describes.

```
src/
  model/                  # Layer 1: record types, no logic
    team.ts
    milestoneInputs.ts    # MilestoneInputs: what the EM types in for the team's milestone; PaceMode, TicketsSource, the skipped periods and reads seen
    ambiguity.ts          # Ambiguity and AmbiguityRanges: set by the EM
    connection.ts         # Connection: the team's one tracker and repo or Jira project (with Jira's account email); never a token
    noneMissing.ts        # NoneMissing: a compile-time check that a list of a union's values, such as TEAM_SOURCES, leaves none out
    ticket.ts             # Ticket: all the tool holds of a ticket, as a connector reads it and a saved read keeps it
    choice.ts             # Choice and ChoiceKind: what the EM picks a milestone's tickets by; choiceKindOf reads a kind sent as text
    failure.ts            # Failure: why a connector couldn't answer

  engine/                 # pure: no I/O, no DB, no clock
    index.ts              # the interface: simulateCase, periodEndDate, ENGINE_VERSION and the types only
    random.ts             # the PRNG (xoshiro128**) and the samplers drawn with it: a second, small entry point, kept at the root so test/engine/ checks it against the reference C code's vectors, which Seam A can't show; nothing in src/ outside engine/ imports it
    lib/                  # the rest, private to engine/: the trial loop (simulate.ts), the case's checks (validate.ts), dates, the case's hash, the types, ENGINE_VERSION

  forecast/               # the only module that knows both stored data and the engine
    index.ts              # the one entry point, which app/ and Seam B's tests import alone: the team's handle (`openForecasting`, `Forecasting`), what goes in through it, each view and edit the screens show and post, the limits the screens' fields are given, the app's version, and `rerunForecast`
    lib/                  # the rest, private to forecast/:
      forecasting.ts      # the team's handle, `openForecasting`: opened on storage, a clock (now and the EM's time zone, today worked out from them), the settings and, in the local server build, what it connects with; adds the default team on first launch
      teamCall.ts         # what one handle call reads and saves with: the team, the clock read once (now, today, the time zone), the settings and, in the local server build, its tracker reads and what setup reads with, listing the milestone choices once
      inputsScreenView.ts # the Inputs screen whole, as its URL asks or a refused form shows it again: only the query step shown is built
      submit.ts           # one submit for every form, owning what follows: a renamed milestone's query followed, a refused form's screen, a save in place's Inputs screen
      inputs.ts           # stored data → the Inputs screen's view; a submitted form saved (and where next) or refused (and the screen to show again)
      milestoneInputs.ts  # behind inputs.ts: the milestone's view and edits
      milestoneAssessment.ts # behind both views: the milestone's inputs against the settings and today, with the pace in use: what stops a forecast, the warnings, the pace the forecast runs on
      trackerReads.ts     # behind both views: what the tracker measures from its saved reads: tickets remaining (through queryRead.ts), and the milestone's pace through pace.ts
      pace.ts             # the pace module, `paceOf`: the only place pace is worked out, and the only import pace's callers use; tested only through Seam B
      periodCounts.ts     # behind pace.ts: the saved reads pace is measured from, their finished tickets counted per period side by side in the EM's time zone
      trackerWindow.ts    # behind pace.ts: the tracker's pace window, the skipped periods it reaches back past, and what its bound says
      paceReading.ts      # behind pace.ts: the tracker's reading of pace, and the pace the latest read replaced
      paceInUse.ts        # behind pace.ts: the pace in use, from the source the EM chose, and its notes
      growth.ts           # behind inputs.ts: the ambiguity ranges view and edit; the milestone's growth range
      connection.ts       # the Connect step's view; a connect checked through a connector from a factory passed in, then saved (with its token, through secrets/) or refused; disconnect; a failing keychain or data file refused, changing nothing
      trackers.ts         # each tracker's facts: its name, its token's permission, where a connection reads, its form and what it lacks, its refusals
      milestoneForecastView.ts # stored data → the Milestone forecast screen's view, through the engine; the forecast shown logged in the ledger
      forecastLedger.ts   # the forecast shown logged, once for each case and release (`logForecast`); a logged forecast re-run from its case alone (`rerunForecast`)
      settings.ts         # ForecastSettings and AmbiguityRanges defaults
      appVersion.ts       # the app's version, `APP_VERSION`, imported from `package.json` with no file read: the release a merge to main is tagged as, in every screen's footer, and importable where a forecast is made, beside the engine's
      cadence.ts          # what the screens call a period: a week or a sprint
      calendarDate.ts     # ISO calendar dates: checking and counting days between
      counted.ts          # a count with its words: "1 ticket", "40 tickets"
      editResult.ts       # an edit saved, or refused saying why
      skippedPeriods.ts   # the tracker's periods skipped or counted again, read further back where a skip needs it
      setup.ts            # the setup steps, Connect → Milestone → Comparable work → Check, one at a time; closed with "Use these" to a summary, or skipped to the inputs typed; Change opens them again; Cancel, refused once the steps changed the connection; one SetupContext
      setupSteps.ts       # the four setup steps in order, and the step a URL asks for
      setupSummary.ts     # setup's summary view: its rows, their picks' counts and note, and problem flags
      setupReads.ts       # setup's reads: each pick read at Check for its count (`readPicks`, from `openSetup`), Read again, why a read failed
      queryRead.ts        # reading a query and saving the read, how far back a read reaches (finishedSince, the tracker's periods), whether it is complete, its tickets remaining and weeks read; tested through Seam B
      queryStep.ts        # a query step's view, whole (the Milestone step, or the Comparable work step with its pace and candidates); its searched choices; its submits
      choiceLists.ts      # behind queryStep.ts: each kind's choices as the picker lists them, filtered here or searched in the tracker
      stepQueryEdit.ts    # behind queryStep.ts: the query an edit makes, its picks changed or typed by hand and read back into chips
      readSaid.ts         # behind queryStep.ts: what a step says of its query's read (its line and flag), and why the tracker rejected the query
      stepQuery.ts        # which of the team's queries a query step edits: the milestone query, or comparable work's
      candidates.ts       # comparable work's candidates, read on demand in an opening
      milestoneRenamed.ts # the milestone query following the milestone to its new name
      capacity.ts         # the Capacity section: the team's capacity entries by period, checked, and the warning on a team much smaller than the one forecast; MAX_CAPACITY_PERCENT
      comparableWorkPace.ts # the Comparable work step's pace: the pace in use, each period paired with the milestone's own, each pick's chip, and how the pace compares with the milestone's own so far
      howItWorksView.ts   # the How it works screen's view, from the settings, through the engine
      pacePattern.ts      # the shape the tool names in the counts the pace comes from (steady, lumpy, stepped up...), and the EM's answer to it
      paceTrend.ts        # the counts in use drawn as bars with a least-squares line through them, beside comparable work's and the milestone's own
      paceVersusOwn.ts    # how a pace compares with the milestone's own so far: faster or slower by how much a period, about the same, or too few to compare
      queryLanguage.ts    # each tracker's query language, as the Milestone step reads a milestone query edited by hand, through its one scanner

  connectors/             # what reads the team's tickets from its tracker; everything tracker-specific stays inside one
    connector.ts          # the interface and its shared types: ReadResult, ChoicesOfKind, and Ticket, Failure and Choice re-exported from `model/`; a connector takes its Connection from `model/`
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

  ledger/                 # Layer 5: the forecast ledger's types (`Ledger`, `ForecastLog`), depending only on the engine's; storage keeps it
    ledger.ts

  storage/                # interface and its v1 SQLite file, with the schema's migrations; the web build's browser storage
    sqliteStorage.ts      # the SQLite file: the schema's steps (MIGRATIONS), opening and migrating it, its parts in lib/ put together
    lib/sqliteDatabase.ts # behind sqliteStorage.ts: the open SQLite file, its rows, and a transaction over it
    lib/teamTables.ts     # behind sqliteStorage.ts: the teams, each team's milestone inputs, ambiguity ranges and capacity
    lib/connectionTable.ts # behind sqliteStorage.ts: the team's connection
    lib/savedReadTables.ts # behind sqliteStorage.ts: each query's last read and previous read, with their tickets
    lib/milestoneQueryTables.ts # behind sqliteStorage.ts: the milestone query and comparable work's, and the picks as a row keeps them
    lib/setupTables.ts    # behind sqliteStorage.ts: where setup stands, the setup draft's rows, and why the last reads failed
    lib/setupDraft.ts     # behind sqliteStorage.ts: the team's queries and reads in each target, the setup draft over what's saved; the draft's fields saved; "Use these" applying it
    lib/storedJson.ts     # the one parser for stored JSON (`parseStored`) and the checks each reader builds its shapes from: a shape it doesn't know refused, naming its column
    lib/milestoneInputsJson.ts # the milestone inputs' JSON parts checked, as the SQLite file and browser storage both read them
    lib/forecastLogTable.ts # behind sqliteStorage.ts: the forecast ledger, each team's logged forecasts, only ever added to
    lib/webStore.ts       # behind webStorage.ts and webLedger.ts: browser storage's JSON value by key, read (what it holds, nothing, or refused) and written back whole: the rest once as storage opens, the ledger again at each call
    lib/webLedger.ts      # behind webStorage.ts: the forecast ledger under a key of its own, the newest logs within its bound
    lib/forecastLogJson.ts # a logged forecast's case and result checked, as the SQLite file and browser storage both read them
  app/                    # local server (localhost only), screens, the routes, on the team's `Forecasting` handle, and the request, reply and system clock they run on (`routes.ts`, `appContext.ts`), `npm start` entry point; each screen's HTML, and reading the fields of the forms it posts; the web build's app and page script (`webApp.ts`, `webMain.ts`); the stylesheet every page shares (`html.ts`), each screen's styles in `lib/`, and what is behind the Inputs screen (`inputsScreen.ts`): its Milestone and Pace sections, the parts its sections share (`inputSection.ts`), and the chip on a typed value the tracker reads differently (`readsDifferently.ts`); the Milestone forecast screen's Capacity section (`lib/capacitySection.ts`); the Comparable work step's pace (`lib/stepPace.ts`); the app's version (`APP_VERSION`, from `forecast/index.ts`) in every screen's footer and streamed on the server's `/live`, which each page it serves listens on to reload when the version changes (the web build's pages don't)

test/
  app/                    # the screens, launch, and the launch smoke test: start the app, check the screen is served; the web build's app and its smoke test; the Inputs screen's scripts run in happy-dom (`browserPage.ts` opens a page of the running app, `pagesOnTracker.ts` one for each test)
  engine/                 # Seam A: fixed seeds, plus a performance benchmark
  forecast/               # Seam B: stored inputs + settings → the screens' views
  connectors/             # Seam C: the connector contract suite, its replay transport, the backoff tests' stand-in tracker and waits, and the scenarios and queries recorded for it; each tracker's quirks and recordings in its own folder; the canned connector
  secrets/                # the Secrets contract, run against the in-memory fake and the OS keychain (where one answers); no error quotes the token
  storage/                # the schema's migrations; the Storage contract, run against SQLite and browser storage; the stored values' snapshot (`storedValues.snapshot`), the unions it freezes (`storedUnions.ts`) and the check that keeps it (`storedValues.ts`, run by `storedValues.test.ts`)
  testSeams.test.ts       # each test folder imports only its seam's entry points (architecture-test-seams.md): TEST_SEAMS, the one list
  storedJsonRules.test.ts # nothing in src/storage/ uses JSON but to stringify, but lib/storedJson.ts
  stringValueRules.test.ts # stored union values (storage/storedUnions.ts), string-literal union values in src/ and the schema's CHECK values are camelCase
  typeCheckRules.test.ts  # no `any` in a type position and no `!` but on an index, in src/, test/ or scripts/
  arrangeRules.test.ts    # no test file but the listed exceptions (migration tests, unreadable stored data) writes SQL or opens the database directly
  importScan.ts           # what src/'s and test/'s files import, as paths under src/, for testSeams.test.ts (the scan tests list files and read imports through scripts/sourceFiles.ts)
  sourceCode.ts           # a file's code apart from its comments, strings and regexes, and its templates' text, for storedJsonRules.test.ts, stringValueRules.test.ts and typeCheckRules.test.ts
  sourceCode.test.ts      # sourceCode.ts: what it keeps as code and blanks out, and the templates' text it reads
  isoInstant.ts           # ISO_INSTANT, the shape of the instant storage stamps a logged forecast with, for the tests that check it
  memoryStore.ts          # browser storage in memory (`memoryStore`), with a quota, for the tests run against browser storage
```
