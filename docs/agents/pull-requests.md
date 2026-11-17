# Pull requests

Write the body with `/pr`'s template (Summary, Evidence, Merge Danger). This repo adds the rules below.

## Summary lists the changes

Show each change itself: a diff-sketch of the type, call tree or data shape it changes, and a shallow file tree of the files it touches, each with a one-line comment. A prose summary sits beside the sketches, never instead of them.

## Version

A PR that changes the app sets `version` in `package.json` (semver), which every screen's footer shows:

- **Major**: a one-way door, a stored-data change the EM can't go back from.
- **Minor**: a visible change.
- **Patch**: no visible change.

A docs-only PR doesn't bump it. An open page reloads itself when the app restarts on a different version.

## Evidence shows the output

- **Visible change, built:** screenshots of each screen state, before and after, captured and embedded as in [`demos.md`](demos.md). For "before", use the newest demo of that screen on `main`.
- **Visible change, not built yet** (an integration PR before its tickets land, or a spec): show the **proposed** screens. Screenshot the prototype the spec names in each state it adds, and label them proposed, saying they show the target, not the branch.
  - Commit the images to a `demos/<spec>-proposed` branch cut from the prototype branch, push it, and embed them by that commit's SHA. The prototype and integration branches stay untouched.
  - When a prototype state needs clicks to reach (a folded section opened), change its default in a throwaway copy of the prototype and leave that change uncommitted.
- **No visible change:** the tests that prove it, as pseudocode with before and after, and the suite's pass count.

## Integration PRs (`/implement-spec`)

- The Summary opens with a table of every ticket: number, what it delivers, status (merged, in progress, or blocked by #n).
- A "Merged so far" section gives each merged ticket's diff-sketch.
- After each merge, the orchestrator updates the body: the ticket's status, its diff-sketch, and its demo screenshots, which replace the proposed ones for the states it builds.
- The body ends with `Closes #n` for the spec and every ticket.

## A PR merges only on a green `check`

A PR merges only when CI's `check` job is green. Nothing on GitHub enforces it (branch protection needs the repo public or on GitHub Pro), so the merger checks. Locally, the pre-push hook (`.husky/pre-push`, installed by `npm install`) runs `npm run check`, the typecheck and the tests, and refuses a push that fails it. Don't bypass it with `--no-verify`.

## After a PR merges

When a PR merges into `main`, the path to production ends on this machine:

1. Update `main` locally (`git checkout main && git pull --ff-only`) and delete the merged branch.
2. Remove the closed tickets' workflow labels, as the [Ticket lifecycle](issue-tracker.md#ticket-lifecycle) sets out.

Don't restart the local app yourself. Every merge to `main`, made by anyone, anywhere, runs [`restart-local.yml`](../../.github/workflows/restart-local.yml) on the dev's self-hosted runner, which rebuilds and restarts http://127.0.0.1:5180/ from that commit (`scripts/restartLocal.sh`). A failed run means the app didn't update: report it with the run's output (`gh run list --workflow restart-local.yml`). If the run waits in the queue with no runner, the dev hasn't set one up: point them to `scripts/setupRunner.sh`, run once in a terminal. A run that waits over 24 hours (the Mac away that long) is cancelled; `gh workflow run restart-local.yml --ref main` runs it again.
