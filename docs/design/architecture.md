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

In [`architecture-test-seams.md`](architecture-test-seams.md): Seams A, B and C, and the tests beside them.

## Release

Each merge to `main` is a release an EM can name and run (#241). The app's one version is `version` in `package.json`, set by each PR that changes the app ([`pull-requests.md`](../agents/pull-requests.md#version)). Every screen's footer shows it ("Forecaster 0.3.0"), the web build's page included.

- **When.** The `release` job in `.github/workflows/ci.yml` runs on a push to `main` once its `check` and `browser` jobs pass; a red one runs no release and makes no tag.
- **The tag.** `scripts/releaseTag.ts` gives the merge the tag `v` and its version (`v0.3.0`): `v<version>`, the version semver's major.minor.patch, is the form chosen for the ticket's `v0.<n>.0`, so a patch release is `v0.2.3`. A version already tagged with no app file changed since its tag, as a docs-only merge leaves it, releases nothing, quietly: the app is the one already released. The app's files are `src/`, `package.json` and `package-lock.json`, the `tsconfig` files and `scripts/buildWeb.ts`: what the release builds and runs. A version already tagged with one of them changed since fails the job, saying to bump the version, so no app change goes unreleased silently. A version below the last release fails the job too, saying so.
- **What it carries.** A GitHub release of that tag with notes from its PRs, the built app (`forecaster-v0.3.0.tar.gz`: `dist/` and `package.json`, run with `npm ci`, then `node dist/app/main.js`) and the web build's page (`forecaster-v0.3.0.html`), the file an EM shares.
- **Which release made a forecast.** `forecast/appVersion.ts` imports the version from `package.json` as `APP_VERSION`, with no file read, so it is importable where a forecast is made, beside the engine's `ENGINE_VERSION`. Nothing stores it yet: the forecast ledger (#27) stores it with each `ForecastLog` as `appVersion`, beside its case's `engineVersion` ([`forecast-model.md`](forecast-model.md#layer-5-calibration-ledger)). It sits outside `SimulationCase`: a new release with the same engine gives the same case, `caseHash` and all.

## Language choice

In [`architecture-language.md`](architecture-language.md): TypeScript, and when to revisit it.

## Security

In [`architecture-security.md`](architecture-security.md): credentials, data minimisation, the local server's checks on who is asking, engine input limits and dependencies.

## Deferred beyond v1

In [`architecture-deferred.md`](architecture-deferred.md): what is left out of v1, and how each would be added.

## Open questions

In [`architecture-open-questions.md`](architecture-open-questions.md): what is still to be checked.
