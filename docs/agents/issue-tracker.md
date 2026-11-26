# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations, run inside the clone so it picks up the repo from `git remote`. When a skill says "publish to the issue tracker", create an issue; when it says "fetch the relevant ticket", read it as below.

## Conventions

- **Read an issue**: `gh issue view <number> --json number,title,body,labels,comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.

## Ticket lifecycle

We measure ticket cycle time: from the `in-progress` label being added to the ticket being done. A ticket is done when it closes, or under `/implement-spec` when it is commented `merged`, or under the factory when the factory comments `merged into spec/<n>`.

- Before writing any code for a ticket, run `gh issue edit <n> --add-label in-progress`. Under `/implement-spec`, the orchestrator labels each ticket `in-progress` when it dispatches it, and comments `merged` on the ticket when its branch merges into the integration branch (tickets close together at the end of the run, so closing doesn't time them).
- Under the factory (`.github/workflows/factory.yml`), labelling a ticket or a spec `ready-for-agent` builds it on GitHub's runners, and the workflow does every label and comment write: `/implement` makes no GitHub calls there. How a ticket becomes a PR, how a spec's tickets build on `spec/<n>`, and how to unpark one: [`factory.md`](factory.md).
- If work on a ticket stops without finishing, remove the label: the ticket goes back to the backlog. Restarting it is a new start, so cycle time counts from the last time the label was added.
- When a ticket closes, the board sync (`scripts/syncBoard.sh`) takes its workflow labels (`ready-for-agent`, `in-progress`) off. Cycle time is read from the issue's timeline, so removing the label afterwards doesn't lose it.
- An `epic` only groups child tickets: work happens on its children, and it never gets `in-progress`. Close it when its last child closes.
- Non-epic tickets should be roughly the same size. When splitting work, aim for similar cycle times.
- The [project board](https://github.com/users/random11235/projects/3)'s Status and Health (red, amber, green: whether a card needs someone) follow from the above (closed, an open PR and its checks, the labels, time in progress), set by [`board.yml`](../../.github/workflows/board.yml) on every issue and PR event and daily, so don't move cards by hand. `scripts/syncBoard.sh`'s header gives the rules; if the board looks stale, run it.

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
