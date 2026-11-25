# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations, run inside the clone so it picks up the repo from `git remote`. When a skill says "publish to the issue tracker", create an issue; when it says "fetch the relevant ticket", read it as below.

## Conventions

- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.

## Ticket lifecycle

We measure ticket cycle time: from the `in-progress` label being added to the ticket being done. A ticket is done when it closes, or under `/implement-spec` when it is commented `merged`, or under the factory when the factory comments `merged into spec/<n>`.

- Before writing any code for a ticket, run `gh issue edit <n> --add-label in-progress`. Under `/implement-spec`, the orchestrator labels each ticket `in-progress` when it dispatches it, and comments `merged` on the ticket when its branch merges into the integration branch (tickets close together at the end of the run, so closing doesn't time them).
- Under the factory (`.github/workflows/factory.yml`), labelling an open ticket outside any spec `ready-for-agent` builds it on GitHub's runners, unless it already has an open PR. The workflow does every write: it swaps `ready-for-agent` for `in-progress` and comments the run link, then, once `npm run check` passes on the agent's commits, opens a PR to `main` that closes it, from `agent/<n>-<run id>`, with the body the agent wrote with `/pr`. A run that fails parks the ticket: it removes `in-progress` (and `ready-for-agent`, if still there), adds `parked`, and comments why; the agent's transcript and Sandcastle's log are in the run's `factory-logs` artifact. Label it `ready-for-agent` again to rebuild it on a new branch. Labelling a spec `ready-for-agent` builds its next ticket instead: the first of its sub-issues, in order, that is open, not merged into `spec/<n>`, not `parked`, and has no open blocker other than a ticket already merged (`scripts/factoryFrontier.ts`). It is built on `spec/<n>`, made from `main` if it isn't there yet; the ticket gets `in-progress`, and once `npm run check` passes on the merged tree and `spec/<n>` is pushed, it gets the factory's comment `merged into spec/<n>`, and stays open. Only that comment, opening with the factory's mark, counts as merged into `spec/<n>`: by the factory, which writes as `github-actions[bot]` with its job's `GITHUB_TOKEN`, or by the owner, a member or a collaborator by hand. An `/implement-spec` `merged` comment doesn't, as its merge is into its own integration branch. The spec loses `ready-for-agent` and never gets `in-progress`. A spec ticket whose build fails is parked and `spec/<n>` left unchanged: take `parked` off and label the spec again to retry. One whose commits change `.github/` is parked and not pushed, and a retry would be refused again: build it locally, merge it into `spec/<n>`, then comment `merged into spec/<n>` by hand, opening with the mark, and take `parked` off. One whose commits reached `spec/<n>` but got no merged comment, because the comment failed or the push's step didn't finish, is parked too: comment `merged into spec/<n>` by hand, opening with the mark, and take `parked` off. After a push that failed, or wasn't known to finish, park reads `spec/<n>` and reports whether the push landed or the branch is unchanged. Only when `spec/<n>` moved to some other commit, or reading it failed, can't the factory tell whether it has the ticket's commits, and the park comment says so: if it has them, comment merged by hand; if not, retry. A spec with no ticket to build, or a run whose check of the labelled issue fails, is told why in a comment, and parks nothing: a ticket outside any spec too, whose failed check parked it before specs were built. A ticket whose commits would leave `.sandcastle`, `node_modules`, or a `.claude` or `.claude/skills` that isn't a directory in its branch, `spec/<n>` or `agent/<n>-<run id>`, which the factory won't build on, is parked and not pushed; a branch already holding one parks the ticket before the agent runs, until the owner fixes it. A spec's earlier agents' code on `spec/<n>` runs only in the sandbox: the runner's own code, dependencies and hooks are `main`'s. A spec's ticket labelled on its own isn't built. Every factory comment carries a hidden `<!-- forecaster-factory -->` mark, which keeps it out of the next build's prompt. `/implement` makes no GitHub calls when the factory runs it.
- If work on a ticket stops without finishing, remove the label: the ticket goes back to the backlog. Restarting it is a new start, so cycle time counts from the last time the label was added.
- When a ticket closes, remove its workflow labels (`ready-for-agent`, `in-progress`): `gh issue edit <n> --remove-label ready-for-agent,in-progress`. Cycle time is read from the issue's timeline, so removing the label afterwards doesn't lose it.
- An `epic` only groups child tickets: work happens on its children, and it never gets `in-progress`. Close it when its last child closes.
- Non-epic tickets should be roughly the same size. When splitting work, aim for similar cycle times.
- The [project board](https://github.com/users/random11235/projects/3)'s Status follows from the above (closed, an open PR, the labels), set by [`board.yml`](../../.github/workflows/board.yml) on every issue and PR event, so don't move cards by hand. If the board looks stale, run `scripts/syncBoard.sh`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**, including its fallback). Where sub-issues aren't enabled, also add the child to a task list in the map body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only, the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
