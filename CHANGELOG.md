# Changelog

What each version of the app shipped, newest first. The version is the one in every screen's footer: a fix is in the app you're running if its version is the footer's or older. Each merge's release ([`docs/design/architecture.md`](docs/design/architecture.md#release)) writes its section here, a line from each change file (`changes/<ticket>.md`) a PR that changes the app adds: a PR doesn't edit the entries below ([`docs/agents/pull-requests.md`](docs/agents/pull-requests.md#version)).

## 1.0.5 (2026-11-22)

- The coding standards no check can enforce are kept as rules of thumb, pointing at the checks that cover part of them, with no change to the app (#264, PR #316)

## 1.0.4 (2026-11-21)

- The forecast's handle reads the clock once per call, its submit outcomes and places are told apart by kind, and a refused setup form isn't saved, with no change to the app (#228, PR #307)

## 1.0.3 (2026-11-21)

- `engine/` and `forecast/` keep their internals in `lib/`, each reached through its `index.ts`, and Seam B is tested through the team's handle, with no change to the app (#233, PR #314)

## 1.0.2 (2026-11-21)

- The Inputs screen is built whole, and one submit owns what follows from it, with no change to the app (#246, PR #315)

## 1.0.1 (2026-11-21)

- Code outside a module imports only its entry points, which `npm run lint:boundaries` checks in CI, with no change to the app (#231, PR #309)
- `npm run lint:boundaries` checks the layering between modules in place of the regex test, side-effect and dynamic imports among them, with no change to the app (#232, PR #309)
- `model/` depends only on the engine's types, holding the ticket, choice and failure types connectors answer in, with no change to the app (#234, PR #309)
- The app reaches the forecast through one handle for the team, opened once on a clock, with no change to the app (#245, PR #309)

## 1.0.0 (2026-11-20)

- Every forecast shown is logged in the team's forecast ledger, with its case, hash, result, when and the release that made it, and re-runs from its case alone; the web build keeps it in browser storage apart from the EM's other data, its newest million characters or so (#27, PR #304)

## 0.4.2 (2026-11-20)

- CI fails when a module's coverage by its own test folder drops, with no change to the app (#262, PR #303)

## 0.4.1 (2026-11-19)

- No `any` and no `!` but on an index in the code, checked by a scan test, with no change to the app (#259, PR #298)

## 0.4.0 (2026-11-18)

- The query steps' scripts run in the browser: the find box narrows the lists, and opens candidates, as the EM types. Tests now run the Inputs screen's scripts in happy-dom, so a broken one fails them (#275, PR #296)

## 0.3.1 (2026-11-18)

- A stored string value renamed or removed fails the tests unless a migration maps it where it is stored, with no change to the app (#255, PR #292)

## 0.3.0 (2026-11-18)

- Stored JSON is read through one parser that checks its shape, and stored JSON of a shape the Forecaster doesn't know is refused, naming its column or browser storage's key, rather than misread: the web build shows an error page instead of starting empty, and keeps what is stored. A field it doesn't know, in data it can read, is still dropped when it saves that record (#256, PR #293)

## 0.2.7 (2026-11-18)

- Each merge's release sets the version from the change files its PRs add, so two PRs in flight never conflict on it, with no change to the app (#288, PR #289)

## 0.2.6 (2026-11-17)

- No import cycles in `src/`, with no change to the app (#230, PR #286)

## 0.2.5 (2026-11-17)

- Each test folder imports only its seam's entry points, with no change to the app (#261, PR #287)

## 0.2.4 (2026-11-17)

- Code outside the connectors reaches each one only through a small entry point, with no change to the app (#229, PR #285)

## 0.2.3 (2026-11-17)

- The pre-MVP data-file case moves to the migration tests, with no change to the app (#239, PR #284)
- A pre-push hook runs the checks CI runs, so red code doesn't reach main (#240, PR #284)
- Each merge to main is a release, tagged with the footer's version (#241, PR #284)

## 0.2.2 (2026-11-17)

- The web build forecasts again: the build swaps only the app's own version module, not the engine's (#280, PR #282)

## 0.2.1 (2026-11-16)

- The local server refuses requests from other sites (#270, PR #277)

## 0.2.0 (2026-11-16)

- A date field on the Inputs screen saves on leaving it, not on each part typed (#271, PR #272)

## 0.1.1 (2026-11-16)

- Pace is one module, with no change to the forecast (#243, PR #269)

## 0.1.0 (2026-11-16)

- Open pages reload on a new version, shown in every screen's footer (#252, PR #253). The first numbered version.
- Also shipped under 0.1.0, without a bump of its own: the source reformatted by Prettier, with no change to behaviour (PR #266)
