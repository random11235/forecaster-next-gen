# Pull requests

Write the body with `/pr`'s template (Summary, Evidence, Merge Danger). This repo adds the rules below.

## Summary lists the changes

Show each change itself: a diff-sketch of the type, call tree or data shape it changes, and a shallow file tree of the files it touches, each with a one-line comment. A prose summary sits beside the sketches, never instead of them.

## Version

A PR says how big its change is; the release after it merges sets the number. A PR that changes the app, any of the files `APP_FILES` in [`scripts/changeFiles.ts`](../../scripts/changeFiles.ts) names even if only reformatted, adds a change file, `changes/<ticket>.md`: front matter setting `bump`, and the changelog line as its body.

```
---
bump: patch
---

No import cycles in `src/`, with no change to the app (#230)
```

- **`major`**: a one-way door, a stored-data change the EM can't go back from. A new migration step is one, and so is a change to a stored shape with no step: persisted JSON, or what the web build keeps in web storage.
- **`minor`**: a visible change. A new demo screenshot (`docs/demos/*.png`) is one, as a visible change ships them ([`demos.md`](demos.md)), and so is a visible change with no screenshot.
- **`patch`**: no visible change.

The line names the ticket, not the PR: the release adds the PR's number from its merge commit, as `(#230, PR #286)`. A PR with several tickets adds a file for each. Each file has its own name, so two PRs in flight never edit the same line and the second to merge doesn't conflict.

The PR doesn't set `version` in `package.json` or `package-lock.json`, or edit the entries in [`CHANGELOG.md`](../../CHANGELOG.md). Once CI's run on its merge is green, its `release` job releases its change files as a version, committed and tagged on `main`, as [`architecture.md`](../design/architecture.md#release) sets out. Every screen's footer shows the version, so anyone can read from it whether a fix is in the app they're running. Until the release, a branch's footer shows the last released version, not the one it will become.

`check:static`, so the pre-push hook and CI's `check` job, fails a branch that changes an app file and adds no change file (editing one already on its base adds none, and `changes/README.md` isn't one), has a change file with no valid `bump` or not one line of body, adds a migration step without a `major` bump or a demo screenshot without at least a `minor` one (a branch that adds a demo screenshot needs a change file even if it changes no app file; [`scripts/bumpFloors.ts`](../../scripts/bumpFloors.ts) sets these floors), or sets the version or edits the `CHANGELOG.md` entries (its header is fine), saying what to fix. A docs-only PR adds no change file and releases nothing. An app change merged on a red check, or pushed straight to `main`, without a change file releases nothing either: add its change file in a follow-up PR. An open page reloads itself when the app restarts on a different version.

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

## A PR merges only on a green `check` and `browser`

A PR merges only when CI's `check` and `browser` jobs are both green: the two the release after a merge to `main` waits on. Nothing on GitHub enforces it (branch protection needs the repo public or on GitHub Pro), so the merger checks. Locally, the pre-push hook (`.husky/pre-push`, installed by `npm install`) runs `npm run check`, the checks CI's `check` job runs (the typecheck, the migration check, Prettier, the file-size limit and the change-file check on the branch's changes since `origin/main`, then the tests), and refuses a push that fails it. Don't bypass it with `--no-verify`.

## After a PR merges

When a PR merges into `main`, the path to production ends on this machine:

1. Wait for CI's run on the merge (`gh run watch`, or `gh run list --workflow ci.yml --branch main`): its `release` job commits the version to `main` after the merge. A red run releases nothing and doesn't restart the app: report it with the failing job's output. A failed `release` job says why and what to do ([`architecture.md`](../design/architecture.md#release)).
2. Update `main` locally (`git checkout main && git pull --ff-only`), so it holds the release commit, and delete the merged branch.

Don't restart the local app yourself. CI's green run on each merge to `main`, made by anyone, anywhere, runs [`restart-local.yml`](../../.github/workflows/restart-local.yml) on the dev's self-hosted runner, which rebuilds and restarts http://127.0.0.1:5180/ from `main`'s tip, the release commit included, so the footer shows the version just released (`scripts/restartLocal.sh`). A failed run means the app didn't update: report it with the run's output (`gh run list --workflow restart-local.yml`). If the run waits in the queue with no runner, the dev hasn't set one up: point them to `scripts/setupRunner.sh`, run once in a terminal. A run that waits over 24 hours (the Mac away that long) is cancelled; `gh workflow run restart-local.yml --ref main` runs it again.
