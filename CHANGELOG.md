# Changelog

What each version of the app shipped, newest first. The version is the one in every screen's footer: a fix is in the app you're running if its version is the footer's or older. Each PR that bumps the version adds its line here, as [`docs/agents/pull-requests.md`](docs/agents/pull-requests.md#version) sets out.

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
