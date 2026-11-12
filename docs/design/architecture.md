# Architecture: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1.

This covers the Forecaster as a whole: v1's assumptions, the principles every module follows, the folder structure and its dependency rules, the test seams, the language choice, security, and what is deferred beyond v1. Read it first. The engine (Seam A) is in [`engine.md`](engine.md), the data, samples and settings behind `forecast/` (Seam B) in [`forecast-model.md`](forecast-model.md), and the screens in [`frontend-essentials.md`](frontend-essentials.md).

This builds on the recommendations in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md) ("Implications for a new tool") and the stores in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw).

**The MVP overrides parts of this.** The MVP forecasts one milestone per team from what the EM types in: a start date, the tickets remaining and a pace (a range, or typed counts) per period of the team's cadence, grown by the range of its ambiguity. It has no epics, commits, pull-backs, blocked epics, per-epic ambiguity, team facts, workflow settings, measured pace, measured growth or sample data, and their code is deleted. Where this doc describes them, it is the v1 design they follow on from, not the code as it stands; each such place says so. The tables earlier releases wrote for them are kept in the data file, unread.

The engine is built and tested in isolation first (build order: engine → app on canned data → capacity → Jira → GitHub). The app design ([`frontend-essentials.md`](frontend-essentials.md)) need not match it until the app is built.

---

## v1 assumptions

- **Single team, run locally.** v1 ships two builds of the same app. The local server is a web app started with one command, holding its data in a local SQLite file. The browser build is one self-contained file with no server, shared with testers by sending them the file, holding each viewer's data in their own browser. There is no aggregator and no access control in v1: neither build shares data between people.
- **No risks or added-scope events** are modelled.
- **One reference class per team.** Growth and epic-size samples are pooled per team. The EM expresses how well each epic is understood through its ambiguity level (see [Settings](forecast-model.md#layer-3-settings)), not through separate reference classes.
- **Counts, not story points.** Throughput and scope are measured in tickets.
- **Pace counts only children of the milestone's epics.** KTLO, bugs and tickets outside the milestone's epics are excluded. Time spent on them shows up as slower milestone pace, which is what the forecast needs.
- **Pace is earned, not assumed.** Nothing from before installation is used automatically. Pace starts as a manual range; see [Pace](forecast-model.md#pace) for when measured pace is offered.
- **Committing an epic is manual.** See [Committing](forecast-model.md#committing).

The data model is designed so that each of these can be relaxed later without re-ingesting data (see [Deferred](#deferred-beyond-v1)).

---

## Principles

1. **Keep the layers apart** (described in [`forecast-model.md`](forecast-model.md#data-model)):
   - observed facts from the ticketing tool (append-only)
   - derived samples (can be recomputed, so they can live in the cache)
   - user settings
   - forecasts (never changed once written)
2. **The engine is a pure function: `simulateCase(SimulationCase) → ForecastResult`.** It does no I/O, uses no clock, and gets all its randomness from a seed in the case. That makes forecasts reproducible, and it makes the calibration ledger trustworthy.
3. **Store samples, not summaries.** Keep the raw growth ratios and weekly throughputs, not just a mean or min/max. That keeps the tail, and it lets you change the sampling method later.
4. **Key data by team, not by user.** Throughput belongs to a team. v1 has one team, but keeping every store keyed by `teamId` means a later multi-team phase needs no migration.
5. **Measured data suggests; the EM decides.** Wherever measured data could replace an EM input (pace, the medium growth range), the tool shows it as a suggestion and switches only when the EM accepts.

---

## Folder structure

The tree is `src/` as it stands in the MVP, with `connectors/` and `secrets/`. v1 adds `samples/` (Layer 2: commits, throughput, growth and epic-size samples derived from `model/`), `ledger/` (Layer 5), and the deleted epic-era files (work items, workflow settings, epic commits, team facts, measured pace and growth); [`forecast-model.md`](forecast-model.md) describes them.

```
src/
  model/                  # Layer 1: record types, no logic
    team.ts
    milestoneInputs.ts    # MilestoneInputs: what the EM types in for the team's milestone; PaceMode
    ambiguity.ts          # Ambiguity and AmbiguityRanges: set by the EM
    connection.ts         # Connection: the team's one tracker and repo or Jira project (with Jira's account email); never a token

  engine/                 # pure: no I/O, no DB, no clock; see src/engine/ for its files
    index.ts              # exports simulateCase, periodEndDate and the types only

  forecast/               # the only module that knows both stored data and the engine
    inputs.ts             # Seam B: stored data → the Inputs screen's view; a submitted form saved (and where next) or refused (and the screen to show again)
    milestoneInputs.ts    # behind inputs.ts: the milestone's view and edits
    milestoneAssessment.ts  # behind both views: the milestone's inputs against the settings and today: the pace in use, what stops a forecast, the warnings
    growth.ts             # behind inputs.ts: the ambiguity ranges view and edit; the milestone's growth range
    connection.ts         # Seam B: the Connect step's view; a connect checked through a connector from a factory passed in, then saved (with its token, through secrets/) or refused; disconnect; a failing keychain or data file refused, changing nothing
    trackers.ts           # each tracker's facts: its name, its token's permission, where a connection reads, its form and what it lacks, its refusals
    milestoneForecastView.ts  # Seam B: stored data → the Milestone forecast screen's view, through the engine
    settings.ts           # ForecastSettings and AmbiguityRanges defaults
    cadence.ts            # what the screens call a period: a week or a sprint
    calendarDate.ts       # ISO calendar dates: checking and counting days between
    counted.ts            # a count with its words: "1 ticket", "40 tickets"
    editResult.ts         # an edit saved, or refused saying why

  connectors/             # what reads the team's tickets from its tracker; everything tracker-specific stays inside one
    connector.ts          # the interface and its shared types: Ticket, Failure, ReadResult, Choice, ChoicesOfKind; a connector takes its Connection from `model/`
    remote.ts             # what the network connectors share: sending a request (only a network failure is unavailable), status to failure, the scope check, the finishedSince filter
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
  app/                    # local server (localhost only), screens, `npm start` entry point; each screen's HTML, and reading the fields of the forms it posts; the web build's app and page script (`webApp.ts`, `webMain.ts`)

test/
  app/                    # the screens, launch, and the launch smoke test: start the app, check the screen is served; the web build's app and its smoke test
  engine/                 # Seam A: fixed seeds, plus a performance benchmark
  forecast/               # Seam B: stored inputs + settings → the screens' views
  connectors/             # Seam C: the connector contract suite, its replay transport, the backoff tests' stand-in tracker and waits, and the scenarios and queries recorded for it; each tracker's quirks and recordings in its own folder; the canned connector
  secrets/                # the Secrets contract, run against the in-memory fake and the OS keychain (where one answers); no error quotes the token
  storage/                # the schema's migrations; the Storage contract, run against SQLite and browser storage
  dependencyRules.test.ts # the dependency rules below that keep connectors/ and secrets/ at the edge
```

**Dependency rules:**
- `engine/` imports nothing from the rest of the app.
- `samples/` imports only `model/`.
- `forecast/` is the only module that depends on both stored data and `engine/`.
- `ledger/` depends only on `engine/types.ts`.
- `app/` reaches forecasts through `forecast/`, never `engine/` directly.
- Forecast code reads facts only through team facts (`teamFacts`), never `storage.facts`, so a forecast always sees the EM's status mapping. Storage and storage tests may still read raw facts. (The MVP reads no facts: it has neither, until connectors return.)
- `connectors/`, `storage/` and `secrets/` sit at the edges behind interfaces, so v1 can run from canned data and the same code can be hosted later.
- `connectors/` import only their shared types (`connectors/connector.ts`), what the network connectors share (`connectors/remote.ts`), files in their own folder, and `model/`.
- `forecast/` depends on the connector interface only, never on a concrete connector (`canned/`, `github/` or `jira/`). `app/` builds the connector and passes it in: the canned one from its synthetic fixture in demo mode (`FORECASTER_DEMO=1`), otherwise the real one for the connection. `test/dependencyRules.test.ts` checks both rules.
- `secrets/` imports nothing from the rest of the app. Only `app/` builds a `Secrets` (the keychain in the local server build) and passes it in; `forecast/` imports only the interface (`secrets/secrets.ts`); nothing else imports `secrets/`. The browser build's page script (`app/webMain.ts`) loads nothing from `secrets/`: an `import type` of the interface is all it may reach. `test/dependencyRules.test.ts` checks these rules too.

**File types:**
- Source is `.ts`.
- Tests are `.test.ts`.
- Fixtures are `.json`, in the same shape a connector produces (or the raw API response, for connector replay tests).
- Settings defaults are a typed `.ts` constant.

**Test seams.** There are three:
- **Seam A** is `simulateCase`, tested with fixed seeds ([`engine.md`](engine.md)).
- **Seam B** is `forecast/`: stored facts, settings and the ledger go in, and the screens' views come out: `milestoneForecastView` for the Milestone forecast screen, and `inputsView` with `submitInputs` for the Inputs screen. `submitInputs` takes a form as typed (`InputsEdit`) and either saves it, saying which screen comes next, or refuses it, naming the screen to show again and returning its view: the Inputs screen with the Inputs view, or the Milestone forecast screen with the Milestone forecast view, each with that form as typed, the rest as saved, and the refusal on the form it belongs to. Capacity's forms are on the Milestone forecast screen and refuse to it; every other form is on the Inputs screen. `app/` shows whichever screen the result names, so refused re-display is tested here, without the server. The Connect step on the Inputs screen has its own pair, `connectionView` and `submitConnection`, given what the local server build connects with (`Connecting`: the connection storage, the `Secrets`, and a factory building a connector from a connection and token); the browser build passes none, and its view has no Connect or Milestone step. Its tests use the canned connector and `openMemorySecrets`. Once connected, the Milestone step has its pair too, `milestoneStepView` and `submitMilestoneQuery` (`forecast/milestoneStep.ts`): the view asks for the milestone choices once as it opens and filters them by what the EM typed; a submit adds or removes a pick, saves the picks with the milestone query they join into with OR (`MilestoneQueryStorage`), and reads that query once through `readQuery`. A query's read goes through `readQuery`, which saves it (`SavedReadStorage`) or, failing, leaves the saved read in place; `finishedPerPeriod` buckets its finishes into periods, each on its calendar day in the EM's time zone, and `ticketsRemaining` counts its open tickets. Their tests read through the canned connector too. Reading a form's fields from the request body stays in `app/`, beside the HTML that names them. Both views take the same `ForecastSettings` and judge the milestone by one assessment (`assessMilestone`), so the typed counts a forecast needs, the notes beside the inputs and the Inputs screen's hint all come from those settings. In v1, team facts is part of it and tests may call `teamFacts` directly; the MVP has no team facts. Its logic is in [`forecast-model.md`](forecast-model.md).
- **Seam C** is the connector interface (`connectors/connector.ts`): a connector built from a connection, a token and a transport goes in, and its milestone choices and reads come out. See [Seam C](#seam-c-connectors) below.

Warning text and provenance are tested at Seam B, not Seam A. These cases moved from the engine tests. Each is owed, in `test/forecast/`, by the ticket that adds its warning or diagnostic. Since the MVP, only the first two can arise: the last four name epics, commits or measured pace, which return after it.
- the horizon warning when fewer trials finish than the highest reported percentile, with the floored percentage and the horizon date, and none when enough finish;
- the long-forecast warning above `warnAboveWeeks` weeks, none at or below it, its ticket figure for 'when' and 'howMany', a median beyond the horizon counting as over, the threshold coming from `ForecastSettings`, and weeks (not periods) keeping their meaning when `periodDays` changes;
- the growth source of each epic in rank order: samples, ambiguity range, or epic size for a null or 0 `baseCount`;
- the throughput scope reported as `'milestoneEpics'`;
- the throughput source: `'measured'` for samples, `'manual'` for a range;
- the uncommitted epics listed in rank order, and none for a scope of committed epics.

Seam B tests read tickets through the canned connector (`connectors/canned/`), which returns its fixture's tickets, an empty list for a query that matches nothing, and any failure on cue; `test/connectors/` tests it.

### Seam C: connectors

Each real connector is tested at Seam C, offline, on raw responses recorded from the synthetic trackers and replayed through its injected transport.

A rate limit (a 429, or a GitHub 403 whose headers say it is one; on Jira only a 429) is backed off inside the connector, by the backoff both share beside `send` (`connectors/remote.ts`): the request is sent again up to three times, after the wait the tracker asks for (its `retry-after`, or, for GitHub's primary rate limit, until its `x-ratelimit-reset`), else 1, 2 and 4 seconds. Still rate limited after that, or asked to wait more than a minute, the call fails as `unavailable`. No other failure is sent again. Each connector takes how it waits as an optional last argument (`Wait`, a timer by default), so the suite backs off without waiting out real delays: its `rateLimited` subject puts a tracker answering 429s in front of the replay.

- **The contract suite** (`test/connectors/connectorContract.test.ts`), modelled on the Storage contract, runs the same cases against every connector: a read returning tickets, a query matching nothing (an empty list, not a failure), each failure, milestone choices returning choices or a failure, and a picked nested epic read to every leaf beneath it, its sub-epics found by the read rather than kept in the query (a tracker whose connector doesn't expand epics yet gives no nested-epic query, and skips those cases). Each connector joins it with a `ContractSubject` (`connectorContract.ts`): its connector on the synthetic tracker, with a refused token, on an unknown repo or project, with no network (its transport rejects with the `TypeError` `fetch` does), and replaying no recordings, plus its queries in the tracker's syntax, its tickets' ids by role, and the roles its hierarchy cases read. A tracker whose search caps its results (GitHub's, at 1,000) also gives a connector on a search finding more than the cap; the synthetic repo is too small to reach it, so that one stands in for GitHub rather than replaying it. A connector maps only a network failure to `unavailable`, so on a request with no recording the replay's error propagates and the case fails loudly; the suite checks this for each connector. Later specs add their cases to this suite. Tracker-only quirks are tested beside it, in the tracker's own folder (`test/connectors/github/`, `test/connectors/jira/`).
- **The replay transport** (`test/connectors/replayTransport.ts`) answers each request with the recording of the same method, URL and body, and throws, naming the request, when there is none, so a missing recording never passes silently.
- **Recordings** come only from the synthetic trackers (`random11235/forecaster-synthetic` for GitHub, the space `SYN` on `ralphhockley.atlassian.net` for Jira), which `scripts/synthetic/` seeds; its manifests map each case's role to its ticket. Failures are real recorded responses where the tracker gives one: a refused token is recorded with a token the tracker refuses, an unknown repo or project with one that doesn't exist. Only the network failing is not recorded. Recordings keep each response's status and only the fields the connector reads, and no headers.
- **The scenarios** (`test/connectors/scenarios.ts`) name, for each tracker, what is recorded: the synthetic connection, the unknown one, and the queries read in each scenario, among them the tracker's own quirks (such as GitHub's short-form `parent-issue:#106`, which matches nothing). The contract suite replays them and the recording script records them, so the two can't drift.
- **The recording script** (`scripts/record.ts`: `npm run record` for both trackers, `npm run record:github` or `npm run record:jira` for one) reads its tokens from the macOS Keychain (`forecaster-github-recording`, `forecaster-jira-recording`) and records Jira as the shared test account `forecastertest3@gmail.com` (`FORECASTER_JIRA_EMAIL` overrides it), never writing a token anywhere, runs each connector's own requests against its synthetic tracker, reading each query both from the start (`FROM_THE_START`) and from the manifest's `cut`, the two `finishedSince`s the contract cases read from, and rewrites `test/connectors/<tracker>/recordings/`. It says plainly when a tracker refuses its token: GitHub's expires on 2026-12-07, Jira's after 30 days. A change to a connector's requests needs a re-run: the replay transport names any request left unrecorded. Node runs the script directly, so the files it imports from `src/` and `test/` (`connectors/remote.ts`, `recording.ts`, `scenarios.ts`), named by their `.ts`, must import nothing at runtime themselves; `test/connectors/recordScript.test.ts` checks that it loads. It loads the connectors from the build in `dist/`.
`test/app/` holds the launch smoke test. It is not a forecasting seam: it builds the app, runs the built `npm start` entry point (`dist/app/main.js`) with `FORECASTER_NO_BROWSER=1` so no browser opens and a temporary `FORECASTER_DATA_FILE`, and checks that the Milestone forecast screen is served in its empty state, with no sample data. It runs it again in demo mode (`FORECASTER_DEMO=1`), on the canned connector built from the synthetic fixture, so no token is needed, and checks the screen is served. It also checks that a bad `PORT` is refused.

The web build is tested the same way, with no seam of its own: `webApp.test.ts` asks its app for screens as its page does, and the web build smoke test runs `npm run build:web` and checks the one page it writes opens on the empty state with its script inline. Its page script (`webMain.ts`), which wires links, forms and the Inputs screen's saves to that app in the browser, is checked by the ticket's demo, not by tests.

The one exception is the PRNG: `engine/random.ts` is checked against output vectors from the authors' reference C code for xoshiro128**, because a port must reproduce its exact stream and Seam A can't show that.

`test/storage/` holds the Storage contract, one suite run against both the SQLite file and the web build's browser storage, and the schema migration tests. The team's connection, the last read of each query, and the milestone's picks and query (`ConnectionStorage`, `SavedReadStorage` and `MilestoneQueryStorage`, part of `openSqliteStorage`'s `SqliteStorage`) are kept only by the SQLite file, so their cases run against SQLite alone: the browser build has no connectors. The migration tests are not a forecasting seam either: they write a data file as an earlier release left it, open it through `openSqliteStorage`, and check what reads back. A ticket that changes the schema appends a step to `MIGRATIONS` in `src/storage/sqliteStorage.ts` (never editing a released one) and adds a test there that opens a file from the version before.

---

## Language choice

**TypeScript for the engine. Revisit only if a benchmark shows it's needed.**

- **The workload is small.** A "when" forecast with 10,000 trials, 10 epics and a 30-week horizon is about 400,000 random draws. That takes milliseconds in JavaScript. Back-testing 200 historical forecasts takes seconds and runs in the background.
- **A compiled engine has costs:** two toolchains, serialisation across the language boundary, harder debugging, and more friction while the model is still changing.
- **It would pay off for** batch forecasting across many teams on every sync, per-item daily simulation (cycle times, WIP limits, dependencies), or very large trial counts.
- **Cheap wins in TypeScript:** `Float64Array` for samples and outcomes, a fast seeded PRNG, and no allocation inside the trial loop.
- **Benchmark guardrail:** `test/engine/` asserts that 10k trials over a realistic case finish within a budget (e.g. 100 ms).
- **Escape hatch:** port only `engine/` to Rust compiled to WebAssembly, which runs in the browser and in Node. Because the engine is pure, with one entry point, the port is a drop-in replacement. The fixture tests become the conformance suite: with the same PRNG and seed, both implementations must give identical quantiles.

---

## Security

v1 is a local, single-user tool, so items 1 and 2 are what matter. Items 3 and 4 still apply; the rest becomes relevant only with a hosted or multi-team version.

1. **Ticketing credentials.**
   - Use read-only access: for Jira, a scoped API token with read-only scopes (`read:jira-work`) that expires, sent as basic auth with its account's email through Atlassian's gateway; OAuth 2.0 (3LO) with read scopes may replace it later. For GitHub, a GitHub App or fine-grained token with read-only issue access. A classic (unscoped) API token or PAT carries all of that user's permissions, including write access.
   - Store tokens in the OS keychain, through `secrets/`, keyed by team. Never put them in the browser, `localStorage`, the SQLite file, logs or error messages. Nothing but `secrets/` holds a token: it goes from there to the connector when the connector is built. A keychain failure drops the keychain's own error, which might quote the token.
   - No webhooks in v1. Connectors poll on refresh.
2. **Data minimisation.** The model needs only IDs, types, parent links, labels, status timestamps and counts. Don't ingest titles (except epics', which name them on screen), descriptions, comments or assignee identities. Capacity is typed for the team as a whole, so there is no `Person` table.
3. **Engine input limits.**
   - Cap `trials`, sample-array sizes, `maxPeriods` and the number of epics in `scope` (100, `MAX_EPICS`) in `forecast/buildCase.ts`, and check them again at the engine boundary. The epic cap is a memory guard: the engine keeps a finish period per epic per trial.
   - The PRNG does **not** need to be cryptographic. A fast seeded PRNG is correct.
4. **Dependencies.**
   - Keep `engine/` free of dependencies.
   - Commit a lockfile and run `npm audit` or Dependabot.
   - TypeScript and Rust/WASM are both memory-safe, so the language choice doesn't change the security picture.
5. **Later, for hosted or multi-team use:**
   - Scope every query by team. Aggregators and stakeholders see summaries only, never item-level data.
   - Encrypt tokens at rest server-side, and verify webhook signatures.
   - The forecast ledger is append-only, with `createdBy` recorded. Calibration numbers mean nothing if old forecasts can be edited.

---

## Deferred beyond v1

| Feature | What changes |
|---|---|
| Pre-installation history (v1.1 or v2) | Read ticket history from before installation to measure pace, and growth from epics never committed. (Epics committed by label before installation already count; see [Samples](forecast-model.md#samples).) The risks to handle: a different team, a different KTLO load, different products, company-wide efforts, or a change of method (e.g. story points to Kanban). In v1, old data may only pre-fill a suggestion. |
| Other pace scopes (v2) | Pace from children of any epic, or from all of the team's work. Derive `ThroughputSample`s with that `scope` from `WorkItem.parentId`; the forecast's `throughputScope` reports the choice. |
| Per-epic dates in the UI | Shown only after evidence (back-testing or the ledger) that they're reliable despite parallel work. |
| Multi-team | An aggregator, the stakeholder roadmap, publishing, cross-team reference split rates, and access control. The data is already keyed by team. |
| Risks / added-scope events | Add `AddedScopeEvent { probability, impactLow, impactHigh }`, applied once per trial. |
| Reference classes | Add `ReferenceClass { workType }` if the ledger shows growth differs by work type beyond what the ambiguity levels capture. |
| Sampling experiments | Add throughput sampler kinds beside `bayesianBootstrap` and `bootstrap` (interpolated empirical, smoothed bootstrap/KDE, Poisson or negative binomial fit, block bootstrap, recency-weighted bootstrap), each with its parameters in `ThroughputSamplerConfig`. Back-test each against the ledger. Changing the default needs an ADR; [ADR-0001](../adr/0001-bayesian-bootstrap-pace-sampler.md) chose the current one on synthetic evidence, before the ledger had data. Can extend to the growth and epic-size draws. |
| Flow signals | Feed Work Item Age against cycle-time percentiles back in as "likely to split". |
| Other trackers | Linear, Azure DevOps. Webhooks. |

## Open questions

- **Minimum growth samples** before measured samples are suggested: start at 7 (Magennis), then test against the ledger.
- **Default ambiguity ranges** (low 1–1.5×, medium 1–2×, high 1.5–3×): check against the ledger once milestones finish.
- **Default epic-size range** for epics with no children before enough `EpicSizeSample`s exist.
