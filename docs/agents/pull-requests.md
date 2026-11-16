# Pull requests

Write the body with `/pr`'s template (Summary, Evidence, Merge Danger). This repo adds the rules below.

## Summary lists the changes

Show each change itself: a diff-sketch of the type, call tree or data shape it changes, and a shallow file tree of the files it touches, each with a one-line comment. A prose summary sits beside the sketches, never instead of them.

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

## After a PR merges

When a PR merges into `main`, the path to production ends on this machine:

1. Update `main` locally (`git checkout main && git pull --ff-only`) and delete the merged branch.
2. Remove the closed tickets' workflow labels, as the [Ticket lifecycle](issue-tracker.md#ticket-lifecycle) sets out.
3. Restart the local app from `main`, so http://127.0.0.1:5180/ shows what merged:
   - Stop whatever listens on port 5180 (`lsof -tiTCP:5180 -sTCP:LISTEN | xargs kill`).
   - Run `npm install && npm start` in the background from the repo root, and wait for `Forecaster running at`.
   - If the build fails, say so with its output; don't leave the old app running as if it were updated.
