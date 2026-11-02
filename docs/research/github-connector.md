# What a read-only GitHub connector can read

Research date: 2026-11-02. Question from the wayfinder ticket [What a read-only GitHub connector can read](https://github.com/random11235/forecaster-next-gen/issues/126) (map: [Connected forecasting](https://github.com/random11235/forecaster-next-gen/issues/124)).

**Question:** What can a read-only connector get from GitHub to propose a milestone's **tickets remaining** and its **typed counts** (finished tickets per past period, at the milestone's **cadence**)? It covers issue state history, milestones, labels, sub-issues, Projects (v2) status and its history, search, auth for a local app, rate limits and the cost of one refresh, and REST against GraphQL.

Citation convention: bracketed numbers refer to **Sources** at the end. **Observed** marks something checked by calling the live API with `gh` on 2026-11-02 (the call is given in the note). **Synthesis** marks my own reasoning. **Unverified** marks a claim no source settles.

This updates §10.3 of [forecasting-approaches.md](forecasting-approaches.md#103-github-issues-and-projects), which said Projects (v2) status history was not readable. That is no longer true (see §2).

---

## Short answer

1. **Tickets remaining** is one paginated GraphQL query: a milestone's `issues(states: OPEN)` [1]. The milestone's own `openIssueCount`/`closedIssueCount` also count pull requests, so they are not tickets remaining (**Observed**, §1).
2. **Finished tickets per period** comes from each closed issue's `closedAt` and `stateReason` (`COMPLETED`, `NOT_PLANNED`, `DUPLICATE`) [1]. Count only `COMPLETED`, bucket by `closedAt` into periods of the cadence.
3. **Reopens and moves** need the issue timeline: `ClosedEvent` and `ReopenedEvent` (both carry `stateReason`), `MilestonedEvent`/`DemilestonedEvent` (milestone *title* only), labels, sub-issue and parent events, and issue-type changes [1]. `closedAt` alone gives only the *last* close.
4. **Projects (v2) status history is now readable**: the issue timeline has `ProjectV2ItemStatusChangedEvent` with `previousStatus`, `status`, `project`, `createdAt` and `wasAutomated` [1], added to the public schema on 2025-10-15 [3]. Only GraphQL returns the status values; REST lists the event without them (**Observed**).
5. **GraphQL, not REST**, for the refresh: one query returns a milestone's issues with their state, reason, type, labels, sub-issue summary and filtered timeline, 100 issues per page, at about 2 points per page out of 5,000 an hour (**Observed**). REST needs one timeline call per issue.
6. **Auth:** a fine-grained personal access token with repository **Issues: read** covers issues, milestones, timelines and sub-issues [5]. It cannot reach **user-owned** Projects (v2) at all [6]; organization projects need organization **Projects: read** [5]. A GitHub App with the device flow is the alternative that needs no secret in the app [7].
7. **Search** can count issues per week in one call each (`milestone:"…" is:closed reason:completed closed:A..B`) [9][10], but it reads *current* state and membership, has its own 30 requests/minute limit and a 1,000-result cap [9]. Useful for a quick check, not as the source of history.

---

## 1. Milestones and tickets remaining

- **GraphQL `Milestone`** has `number`, `title`, `state`, `dueOn`, `createdAt`, `closedAt`, `openIssueCount`, `closedIssueCount`, `progressPercentage`, and an `issues` connection filtered by `states`, `labels`, `filterBy` and `orderBy` [1].
- **The counts include pull requests (Observed).** On `microsoft/vscode` milestone "1.144.0", `openIssueCount + closedIssueCount` was 962 while `issues(states:[OPEN,CLOSED]).totalCount` was 238. So tickets remaining must come from the `issues` connection, not the milestone's counts. (`gh api graphql`, query on `repository(owner:"microsoft", name:"vscode").milestones`.)
- **REST** `GET /repos/{owner}/{repo}/issues?milestone={number}&state=all` lists the same issues, 100 a page, filterable by `labels` and issue `type`, and returns `state_reason`, `closed_at`, `type` and `sub_issues_summary` [4]. It also returns pull requests, told apart by the `pull_request` key [4].
- **Synthesis, for the spec:** which open issues count as tickets is a mapping choice the connector must expose: exclude pull requests always, and probably exclude issues that have sub-issues (parents) or a given issue type or label, so an epic-like parent is not counted as one ticket. `subIssuesSummary { total completed }` and `issueType` make that cheap to apply [1].

## 2. State history: closed, reopened, reason, and Projects status

### Issue fields

- `Issue.state`, `closedAt`, `stateReason` [1]. `IssueStateReason` is `COMPLETED`, `NOT_PLANNED`, `DUPLICATE` or `REOPENED` [1]. The REST equivalent is `state_reason` with `completed`, `not_planned`, `duplicate`, `reopened` or null [4].
- `closedAt` is the last close only. An issue closed in week 2, reopened in week 3 and closed again in week 5 shows week 5 (**Synthesis** from the field's meaning; the timeline below gives the full sequence).

### Timeline events (GraphQL `timelineItems(itemTypes: [...])`)

The `IssueTimelineItemsItemType` enum includes [1]:

| Need | Event types |
|---|---|
| Finish and unfinish | `CLOSED_EVENT` (`createdAt`, `stateReason`, `closer`, `duplicateOf`), `REOPENED_EVENT` (`createdAt`, `stateReason`) |
| Milestone membership over time | `MILESTONED_EVENT`, `DEMILESTONED_EVENT` (`createdAt`, `milestoneTitle` only, no milestone id) |
| Labels | `LABELED_EVENT`, `UNLABELED_EVENT` |
| Hierarchy | `SUB_ISSUE_ADDED_EVENT`, `SUB_ISSUE_REMOVED_EVENT`, `PARENT_ISSUE_ADDED_EVENT`, `PARENT_ISSUE_REMOVED_EVENT` |
| Issue type | `ISSUE_TYPE_ADDED_EVENT`, `ISSUE_TYPE_CHANGED_EVENT` (`issueType`, `prevIssueType`), `ISSUE_TYPE_REMOVED_EVENT` |
| Projects (v2) | `ADDED_TO_PROJECT_V2_EVENT`, `REMOVED_FROM_PROJECT_V2_EVENT`, `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` |
| Moved repos | `TRANSFERRED_EVENT` |

- **`ProjectV2ItemStatusChangedEvent`** has `actor`, `createdAt`, `previousStatus: String!`, `status: String!`, `project: ProjectV2` and `wasAutomated: Boolean!` [1]. The GraphQL changelog lists it as added on 2025-10-15 [3].
- **Observed on this repo** (issue "Typed counts need 4 for a forecast", a user-owned project): the timeline returned `"" → Backlog`, `Backlog → In progress`, then `ClosedEvent stateReason: COMPLETED`, then `In progress → Done` two seconds later. `wasAutomated` was `false` on the `Done` change even though it followed the close by two seconds, so `wasAutomated` cannot be trusted to separate project workflows from people (**Observed**, one case).
- **It records the field named "Status" only.** Changes to other single-select or iteration fields have no timeline event in the schema [1] (**Synthesis** from the event's fields: it has no field name, only status strings).
- **Unverified:** whether status changes made before 2025-10-15 were back-filled. The schema and changelog do not say. For a team with older history, the connector should not assume status history before that date.
- **Current Projects values** are readable on any issue through `projectItems { fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name updatedAt } } }` [1][8]. `updatedAt` is only the last change.

### REST timeline versus GraphQL (Observed)

- `GET /repos/{owner}/{repo}/issues/{n}/timeline` (100 a page [2]) lists `added_to_project_v2`, `project_v2_item_status_changed`, `parent_issue_added` and the rest, but the status event carries **no** `status`/`previous_status` values, only id, time and actor.
- The REST `closed` event's `state_reason` was `null` on issues closed as completed (this repo's "Typed counts need 4 for a forecast"), while GraphQL `ClosedEvent.stateReason` returned `COMPLETED` for the same event. It was `not_planned` on issues closed as not planned. GitHub's REST event-types reference lists no `state_reason` on `closed` at all [11]. So REST can't reliably tell a completed close from a reason-less one; GraphQL can.

## 3. Labels, sub-issues, issue types

- **Labels:** `Issue.labels(first: N)` (current), plus labeled/unlabeled timeline events for history [1]. REST list issues filters by comma-separated labels [4].
- **Sub-issues:** GraphQL `Issue.parent`, `subIssues`, `subIssuesSummary { total completed percentCompleted }` [1]. REST `GET /repos/{owner}/{repo}/issues/{n}/sub_issues` with Issues: read [5][12]. Sub-issue history comes from the four sub-issue and parent timeline events [1].
- **Issue types** (`issueType { name }`, REST `type`) can be filtered on both APIs [1][4]; they are set per organization, so a user-owned repo usually has none (**Observed**: `issueType: null` here).

## 4. Search

- Qualifiers useful here: `is:issue`, `milestone:"…"`, `is:closed reason:completed` or `reason:"not planned"`, `closed:YYYY-MM-DD..YYYY-MM-DD`, `type:"Bug"`, `no:project`; advanced search adds `AND`/`OR` and parentheses five levels deep [10].
- **Observed:** GraphQL `search(type: ISSUE, query: "repo:microsoft/vscode is:issue milestone:\"1.144.0\" is:closed reason:completed closed:2026-10-19..2026-10-25") { issueCount }` returned 203 at a cost of 1 point, with several aliased searches in one request.
- **Limits:** 30 requests a minute for issue search when authenticated (10 for semantic or hybrid issue search), at most 1,000 results per search, 100 per page, `incomplete_results` on timeouts, and queries over 256 characters or with more than five `AND`/`OR`/`NOT` fail [9].
- **Synthesis:** search matches today's state and milestone. An issue moved out of the milestone, or reopened, drops out of past weeks. That is fine for "what's left" and a rough weekly count, but typed counts proposed as *measured* should come from the timeline.

## 5. Auth for a local app

| | Fine-grained PAT | GitHub App, user access token (device flow) | Classic PAT |
|---|---|---|---|
| Read-only grant | Repository **Issues: read** covers list issues, timeline, events, milestones and sub-issues [5] | App registered with Issues: read (+ org Projects: read); the token gets only what *both* the app and the user have [7] | `repo` / `public_repo` and `read:project` [8]; `repo` carries write, which [architecture.md Security](../design/architecture.md#security) rules out |
| Projects (v2) | Org projects: organization **Projects: read** [5]. **User-owned projects: not supported** [6] | Org projects: Projects: read [5]. User-owned: **Unverified** | `read:project` [8] |
| Scope | One resource owner (one user or one org) [6] | The repos the app is installed on | Everything the user can reach |
| Life | Default 30 days; org policy may cap it; an org may require approval before it reads anything private [6] | Token 8 hours, refresh token 6 months [7] | Optional expiry |
| Secret in the app | None (the user pastes the token) | Device flow needs only the client ID, no client secret, once enabled in the app's settings [7] | None |

- GitHub recommends a GitHub App "to access resources on behalf of an organization, or for long-lived integrations" [6].
- **Synthesis:** for the local server build, a fine-grained PAT with Issues: read (plus org Projects: read if the team's board is an org project) is the simplest read-only path, stored in the OS keychain as the architecture already says. Its gap is a user-owned project board: the issue fields and timeline still work, but whether `ProjectV2ItemStatusChangedEvent.project` and status values come back without project access is **Unverified** (this research's calls used a classic token with `read:project`). The connector can fall back to closed/reopened events, which need only Issues: read.

## 6. Rate limits and the cost of one refresh

- **REST:** 5,000 requests an hour for a user token, 5,000–12,500 for an app installation, 15,000 on Enterprise Cloud; 60 unauthenticated [13]. Secondary: 100 concurrent requests (shared with GraphQL), 900 points a minute, most GETs 1 point [13].
- **GraphQL:** 5,000 points an hour per user [14]. A query's cost is the number of connection requests it could need, assuming every `first`/`last` is filled, divided by 100, minimum 1; `first`/`last` must be 1–100; at most 500,000 nodes per call; 2,000 points a minute; requests over 10 seconds time out and cost extra [14].
- **Observed cost of a refresh page:** one GraphQL call fetching a milestone's first 100 issues, each with `state`, `stateReason`, `closedAt`, `issueType`, `labels(first: 20)`, `subIssuesSummary` and `timelineItems(first: 50, itemTypes: [CLOSED, REOPENED, MILESTONED, DEMILESTONED, PROJECT_V2_ITEM_STATUS_CHANGED])`, cost **2 points** (microsoft/vscode milestone "1.144.0", 238 issues, so three pages). The largest filtered timeline was 12 events.
- **Synthesis:** a milestone of a few hundred tickets refreshes for under 10 points, about 0.2% of the hourly budget. The same through REST is one list call per 100 issues plus one timeline call per issue: hundreds of requests, still inside 5,000/hour but slower and concurrency-bound. Rate limits do not shape the refresh design; history depth (how many past periods to read) and issues that left the milestone do.
- **Synthesis, a gap:** a milestone's `issues` lists only issues in it *now*. Tickets finished in the milestone and later moved out are gone from that list; finding them needs search or a scan of the repository's recently closed issues with their milestone timeline. Whether that matters is a spec question.

## 7. REST versus GraphQL

| | REST | GraphQL |
|---|---|---|
| Issue list with reason, type, sub-issue summary | Yes [4] | Yes [1] |
| Timeline per issue | One call per issue [2] | Nested in the issue list, filtered by type [1] |
| Projects status values in history | No (event without values, **Observed**) | Yes [1] |
| `stateReason` on close events | Unreliable (`null` for completed, **Observed**; undocumented [11]) | Yes [1] |
| Cost of a milestone refresh | Hundreds of requests | A few points (**Observed**) |
| Org Projects field values | `/orgs/{org}/projectsV2/...` endpoints [5] | `projectItems`, `ProjectV2.items` [1][8] |

**Synthesis:** GraphQL for the connector. REST adds nothing it needs.

## Open questions for the spec

- Which issues count as tickets: exclude parents with sub-issues, certain types or labels? (§1)
- Does a finished ticket count when it closed (`COMPLETED`), or when its project status reached a done column? Closing is available for every repo; status depends on the team using a project.
- How to treat a close that is later reopened: drop it from its period, or count it then subtract? The timeline gives both events.
- Fine-grained PAT (cannot read user-owned project boards) or a GitHub App with the device flow? Needs one quick test of a fine-grained token against `ProjectV2ItemStatusChangedEvent` on a user-owned project.
- Does the period history need tickets that left the milestone after finishing? (§6)

---

## Sources

1. GitHub. Public GraphQL schema (`schema.docs.graphql`), fetched 2026-11-02: types `Issue`, `Milestone`, `ClosedEvent`, `ReopenedEvent`, `IssueStateReason`, `IssueClosedStateReason`, `IssueTimelineItemsItemType`, `ProjectV2ItemStatusChangedEvent`, `ProjectV2Event`, `MilestonedEvent`, `SubIssuesSummary`, `IssueTypeChangedEvent`, `ProjectV2ItemFieldSingleSelectValue`. https://docs.github.com/public/fpt/schema.docs.graphql
2. GitHub Docs. "REST API endpoints for timeline events". https://docs.github.com/en/rest/issues/timeline
3. GitHub Docs. GraphQL "Breaking changes and schema changelog", entry of 2025-10-15 adding `ProjectV2ItemStatusChangedEvent` (synced into the docs repo in github/docs PR "Repo sync", merged 2025-10-15). https://docs.github.com/en/graphql/overview/changelog ; https://github.com/github/docs/pull/40868
4. GitHub Docs. "REST API endpoints for issues": List repository issues. https://docs.github.com/en/rest/issues/issues
5. GitHub Docs. "Permissions required for fine-grained personal access tokens" (Issues, Projects). https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens ; and "Permissions required for GitHub Apps" (Organization permissions for "Projects"). https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
6. GitHub Docs. "Managing your personal access tokens" (fine-grained token limitations, single owner, expiry, approval, when to use a GitHub App). https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
7. GitHub Docs. "Generating a user access token for a GitHub App" (device flow, expiry, permissions intersection). https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
8. GitHub Docs. "Using the API to manage Projects" (`read:project`, reading field values). https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects
9. GitHub Docs. "REST API endpoints for search" (rate limits, 1,000-result cap, query limits, `incomplete_results`). https://docs.github.com/en/rest/search/search
10. GitHub Docs. "Filtering and searching issues and pull requests" (`reason:`, `type:`, advanced search). https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests
11. GitHub Docs. "Issue event types" (`closed`, `reopened` properties). https://docs.github.com/en/rest/using-the-rest-api/issue-event-types
12. GitHub Docs. "REST API endpoints for sub-issues". https://docs.github.com/en/rest/issues/sub-issues
13. GitHub Docs. "Rate limits for the REST API". https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
14. GitHub Docs. "Rate limits and query limits for the GraphQL API". https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
