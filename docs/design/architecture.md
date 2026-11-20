# Architecture: design

Design date: 2026-10-14. Updated 2026-10-18 with the design grill decisions (Q1–Q31). Status: draft for v1.

This covers the Forecaster as a whole: v1's assumptions, the principles every module follows, the folder structure and its dependency rules, the test seams, the language choice, security, and what is deferred beyond v1. Read it first. The engine (Seam A) is in [`engine.md`](engine.md), the data, samples and settings behind `forecast/` (Seam B) in [`forecast-model.md`](forecast-model.md), and the screens in [`frontend-essentials.md`](frontend-essentials.md).

This builds on the recommendations in [`../research/forecasting-approaches.md`](../research/forecasting-approaches.md) ("Implications for a new tool") and the stores in [`../research/EM_usecase-arch.excalidraw`](../research/EM_usecase-arch.excalidraw).

**The MVP overrides parts of this.** The MVP forecasts one milestone per team from what the EM types in: a start date, the tickets remaining and a pace (a range, or typed counts) per period of the team's cadence, grown by the range of its ambiguity. It has no epics, commits, pull-backs, blocked epics, per-epic ambiguity, team facts, workflow settings, measured pace, measured growth or sample data, and their code is deleted. Where this doc describes them, it is the v1 design they follow on from, not the code as it stands; each such place says so. The tables earlier releases wrote for them are kept in the data file, unread.

The engine is built and tested in isolation first (build order: engine → app on canned data → capacity → Jira → GitHub). The app design ([`frontend-essentials.md`](frontend-essentials.md)) need not match it until the app is built.

Each part is in a file of its own.

## v1 assumptions

In [`architecture-v1-assumptions.md`](architecture-v1-assumptions.md): what v1 takes as given, and relaxes later.

## Principles

In [`architecture-principles.md`](architecture-principles.md): the rules every module follows.

## Folder structure

In [`architecture-folders.md`](architecture-folders.md): `src/` and `test/`, folder by folder and file by file.

## Dependency rules and file types

In [`architecture-dependency-rules.md`](architecture-dependency-rules.md): what each module may import, and the file types.

## Test seams

In [`architecture-test-seams.md`](architecture-test-seams.md): Seams A, B and C, and the tests beside them. In [`architecture-test-seams-connectors.md`](architecture-test-seams-connectors.md): how each connector is tested at Seam C. In [`architecture-test-seams-storage.md`](architecture-test-seams-storage.md): the Storage contract and the migration tests. In [`architecture-test-seams-scripts.md`](architecture-test-seams-scripts.md): the tests of `scripts/`.

## Release

Each merge to `main` is a release an EM can name and run (#241). The app's one version is `version` in `package.json`, set by the release, not the PR (#288). Every screen's footer shows it ("Forecaster 0.3.0"), the web build's page included.

- **What a PR says.** How big its change is, not the number: a PR that changes the app, any of `APP_FILES` in `scripts/changeFiles.ts` (what the release builds and runs), adds a change file, `changes/<ticket>.md`, its front matter's `bump` (`patch`, `minor` or `major`) and its body the changelog line ([`pull-requests.md`](../agents/pull-requests.md#version)). Each PR's file has its own name, so two PRs in flight never edit the same line. Only the author knows whether a change is visible, so the bump stays with the PR, but the check holds it to a floor where the diff shows one: a new migration step needs `major`, a new demo screenshot (`docs/demos/*.png`) at least `minor` (#263). `check:static` (the pre-push hook and CI's `check` job) fails a branch, before merge, that changes an app file or adds a demo screenshot and adds no change file (editing one already on its base adds none, and `changes/README.md` isn't one), has one it can't read, bumps less than that floor, or sets the version or edits `CHANGELOG.md`'s entries, saying what to fix (`scripts/checkChanges.ts`). That check is the only guard: the release doesn't look for app changes with no change file.
- **When.** The `release` job in `.github/workflows/ci.yml` runs on a push to `main` once that run's `check` and `browser` jobs pass, one at a time (`concurrency: release`). A red run releases nothing and makes no tag. GitHub keeps one run waiting per group: a newer merge's replaces one still waiting, which is cancelled, and releases its change files with its own, as its commit holds them.
- **What it releases.** `scripts/release.ts "$GITHUB_SHA"`, on a checkout of `main`'s tip, releases the change files the commit its run checked (`$GITHUB_SHA`) holds as the tip holds them, the same content: those of the merges that run's checks passed, a red merge's too once a later green merge's commit holds it. One a later merge adds, re-adds under the same name or edits is left to that merge's own run. So two merges in before either's release are two versions, in merge order, when their runs release in merge order; if the later merge's run releases first (the earlier one slow or re-run, or replaced while waiting), its commit holds both change files and they release together, as one version. The tag can sit on a tip holding a later merge's code whose run is still going: that merge's line is released by its own run, in the next version. None to release, as a docs-only merge leaves it, releases nothing, quietly.
- **The version.** It raises the last release (the highest `v` tag) by the biggest bump among them, sets the version in `package.json` and `package-lock.json` (both of its places there), adds a `## <version> (<date>)` section to the top of `CHANGELOG.md`, dated the day (UTC) the checked commit was made, one line per change file in merge order with the PR number from the merge that brought it onto `main` (`Merge pull request #N`; one pushed straight to `main` has none), deletes the change files, commits that onto `main`'s tip and tags it `v` and the version (`v0.3.0`): `v<version>`, the version semver's major.minor.patch, is the form chosen for #241's `v0.<n>.0`, so a patch release is `v0.2.3`. It pushes the commit and tag together (`--atomic`), with the job's token, which starts no other workflow. Between merge and release, a branch's footer shows the last released version.
- **Main moving on.** A merge in while the release runs refuses its push. The script fetches, resets onto `main`'s new tip, makes the release again by the same rule, and pushes that, up to three tries in all; then it fails, saying so, and a re-run of the job releases from the tip.
- **A change with no change file.** One merged on a red check, or pushed straight to `main`, without a change file releases nothing: it goes out, unnamed, in the next version. Add its change file in a follow-up PR to name it.
- **What it carries.** A GitHub release of the last tag, with notes from its PRs, the built app (`forecaster-v0.3.0.tar.gz`: `dist/` and `package.json`, run with `npm ci`, then `node dist/app/main.js`) and the web build's page (`forecaster-v0.3.0.html`), the file an EM shares. The job publishes it whenever the last tag has no GitHub release (only `gh release view`'s "release not found" counts; any other failure fails the job), made now or left by a run that failed after its push, building the app from the tag. So a re-run publishes the last tag's release when it's missing; an older tag's, missed once a later release is out, is published by hand from a checkout of that tag:

  ```sh
  TAG=v0.2.7 && git checkout "$TAG" && npm ci && npm run build:web
  tar -czf "forecaster-$TAG.tar.gz" --exclude=dist/web dist package.json package-lock.json && cp dist/web/forecaster.html "forecaster-$TAG.html"
  gh release create "$TAG" --verify-tag --title "Forecaster $TAG" --generate-notes "forecaster-$TAG.tar.gz" "forecaster-$TAG.html"
  ```

- **The tag comes before the build.** The script pushes the tag with its release commit, before the job builds the app, and the tag's tree is `main`'s tip with that commit on it: no step builds that tree before it is tagged. If it doesn't build, the tag stands with no GitHub release, and each later run that releases nothing fails trying to publish it, until the next release or a fix by hand (the commands above, once it builds).
- **The local app.** `restart-local.yml` restarts the dev's local app once CI's run on a merge to `main` completes green, from `main`'s tip, so its footer shows the version just released. A red run leaves the app from before running.
- **Which release made a forecast.** `forecast/lib/appVersion.ts` imports the version from `package.json` as `APP_VERSION`, which `forecast/index.ts` exports, with no file read, so it is importable where a forecast is made, beside the engine's `ENGINE_VERSION`. The forecast ledger (#27) stores it with each `ForecastLog` as `appVersion`, beside its case's `engineVersion` ([`forecast-model.md`](forecast-model.md#layer-5-calibration-ledger)). It sits outside `SimulationCase`: a new release with the same engine gives the same case, `caseHash` and all.

## Language choice

In [`architecture-language.md`](architecture-language.md): TypeScript, and when to revisit it.

## Security

In [`architecture-security.md`](architecture-security.md): credentials, data minimisation, the local server's checks on who is asking, engine input limits and dependencies.

## Deferred beyond v1

In [`architecture-deferred.md`](architecture-deferred.md): what is left out of v1, and how each would be added.

## Open questions

In [`architecture-open-questions.md`](architecture-open-questions.md): what is still to be checked.
