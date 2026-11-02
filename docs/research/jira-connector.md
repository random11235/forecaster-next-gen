# What a read-only Jira Cloud connector can read

Research date: 2026-11-02. Ticket: [What a read-only Jira Cloud connector can read](https://github.com/random11235/forecaster-next-gen/issues/127), for the map [Connected forecasting](https://github.com/random11235/forecaster-next-gen/issues/124).

**Question:** What can a read-only connector get from Jira Cloud to propose a milestone's **tickets remaining** and its **typed counts** (finished tickets per past period, in the milestone's **cadence**)? It also covers auth for a local app, rate limits and paging, the cost of one refresh, and where Jira differs from GitHub in ways a shared connector shape must absorb.

Citation convention: bracketed numbers such as [3] refer to **Sources** at the end. Most Jira REST facts come from Atlassian's own OpenAPI spec for the v3 platform API [1] (version `1001.0.0-SNAPSHOT-d794cfb…`, downloaded on the research date), because the rendered reference pages are too large to fetch. Lines marked **Synthesis** are my own reasoning from the sources. Lines marked **Unverified** could not be checked against a primary source.

---

## Short answer

- **Tickets remaining**: one JQL search. Example: `fixVersion = "<v>" AND statusCategory != Done`, or `parent in (<epics>) AND statusCategory != Done`, with `fields=id`. Page through it with `nextPageToken`. The response has no total; there is a separate count endpoint, which is approximate [1].
- **Finished tickets per period**: each issue's `resolutiondate` gives a finish timestamp without the changelog. The robust source is the changelog's `status` transitions into a Done-category status, which `POST /rest/api/3/changelog/bulkfetch` returns for up to 1000 issues per request, filtered to up to 10 fields [1]. The connector buckets the timestamps into periods itself, from the milestone's start date and cadence (**Synthesis**).
- **Scope**: a milestone maps to a **fix version** (multi-valued, per project) or to **epics** (via `parent`, since "Epic Link" was retired in February 2024), or to a saved JQL filter [4].
- **Done** means status category Done. Resolution is not reliable everywhere: team-managed service spaces have no resolution field [4].
- **Auth**: OAuth 2.0 (3LO) uses a code grant with a **client secret**, has **no documented PKCE**, takes **one** callback URL, and its docs don't say whether `localhost` is allowed [2]. The one read scope needed is classic `read:jira-work`, plus `offline_access` for refresh tokens [2][3]. The alternative is a **scoped API token**: user-created, it expires in 1–365 days, and Atlassian recommends scopes [6].
- **Rate limits**: 3LO apps are on a points budget, 1 point per request plus 1 per object read, 65,000 points an hour in the default global pool, from March 2, 2026. API-token traffic is exempt from points and only burst-limited [5].
- **Refresh cost**: a 300-ticket milestone refreshes in about 3–6 requests and, by my estimate, about 1,000 points or fewer (**Synthesis**, see [Cost of refreshing one milestone](#cost-of-refreshing-one-milestone)).

---

## 1. Scope: which issues belong to the milestone

Jira has no single "milestone" object. A team's milestone is one of these:

| Jira construct | How to query it | Notes |
|---|---|---|
| **Fix version** | `fixVersion = "3.14"` or `fixVersion = 10001` | Multi-valued per issue. The comparison operators use "the version order that has been set up by your space admin". It also supports `releasedVersions()` and `unreleasedVersions()` [4]. Versions carry `startDate`, `releaseDate`, `released` and `archived` [1] (`Version` schema), and `GET /rest/api/3/project/{key}/versions` lists them, unpaginated [1]. `GET /rest/api/3/version/{id}/unresolvedIssueCount` returns "counts of the issues and unresolved issues for the project version" [1]. |
| **Epic(s)** | `parent = TEST-1234` / `parent in (…)` | "As of February 2024, Epic link function has been retired in favor of Parent." `parent` "works for both team-managed and company-managed spaces" and supports only `=, !=, IN, NOT IN`, with no `WAS` or `CHANGED` [4]. `hierarchyLevel` gives 1 for epics, 0 for stories and tasks, and -1 for subtasks [4]. |
| **Saved filter / JQL** | `filter = 12345` | "It is safer to search by filter ID than by filter name" [4]. |

**Synthesis:** a connector should take the scope as a small tagged value (`fixVersion`, `epics`, or `jql`) and build the JQL from it, adding `AND hierarchyLevel = 0` so that subtasks and epics aren't counted as tickets.

## 2. Status categories and "done"

- Every status belongs to one of three categories. `GET /rest/api/3/statuscategory` lists them (scope `read:jira-work`) [1]. The newer workflow schemas name them as the enum `TODO | IN_PROGRESS | DONE` [1]. The issue's `status` field carries its `statusCategory` object (`id`, `key`, `name`, `colorName`) [1].
- JQL has `statusCategory = Done`. The docs mention it under Resolution: "The resolution field doesn't exist in service team-managed spaces … Instead, you can use the statusCategory field (a work item is resolved when statusCategory = Done)" [4].
- `resolution` and `resolved` (alias `resolutionDate`) exist elsewhere. `resolved` supports range operators but not `WAS` or `CHANGED`. It is evaluated "relative to your configured time zone" [4].
- **Synthesis:** use status category Done as "finished". Read `resolution` only to drop "Won't do" and duplicates if the team wants that, the same question as GitHub's `state_reason: not_planned`. Status *names* are per workflow, so the connector should never hard-code them.

## 3. JQL search: the enhanced endpoint

The old `GET/POST /rest/api/3/search` is marked deprecated in the spec ("Currently being removed", [CHANGE-2046](https://developer.atlassian.com/changelog/#CHANGE-2046)) [1]. Use `GET/POST /rest/api/3/search/jql` [1]:

- `jql` "requires a bounded query". For example, `order by key desc` alone is rejected [1].
- Paging uses the **cursor** `nextPageToken`, "not included in the response for the last page". The response has `issues`, `nextPageToken`, `isLast` and an experimental `warnings`, and **no `total`** [1]. The token "will expire in 7 days" [1].
- `maxResults` defaults to 50. "The greatest number of items returned per page is achieved when requesting `id` or `key` only. It returns max 5000 issues" [1]. Pages may be smaller when many fields are asked for.
- `fields` defaults to `id`, unlike the old endpoint's `*navigable` [1]. This suits data minimisation: ask for `status,resolution,resolutiondate,created,parent,issuetype,fixVersions`, and never `summary` or `description` for tickets.
- `expand=changelog` "Returns a list of recent updates to an issue" [1]. It is a `PageOfChangelogs`, so it may be truncated. Use the bulk changelog endpoint for complete history (**Synthesis** from the schema; the cap per issue isn't stated in the spec).
- **Eventual consistency:** "Recent updates might not be immediately visible in the returned search results". `reconcileIssues` gives read-after-write consistency for up to 50 issue IDs [1][7]. For a read-only connector, this means a refresh just after a change in Jira can miss it by seconds.
- `POST /rest/api/3/search/approximate-count` gives "an estimated count of the issues that match the JQL" [1]. It is good for a preview, not for the measured value.

JQL history operators:

- `WAS` and `CHANGED` take `AFTER`, `BEFORE`, `BY`, `DURING`, `ON`, `FROM` and `TO`. They work only with "the Assignee, Fix Version, Priority, Reporter, Resolution, and Status fields". "If a work item has more than 10,000 changes, JQL queries using the WAS operator will only search the most recent changes" [8].
- `status WAS`, `WAS IN` and similar accept only the status name, not its ID [4].
- So `status CHANGED TO "Done" DURING ("2026/10/01","2026/10/08")` can count one period server-side. But it works by status *name*, not category, and needs one query per period. Reading the changelog once is simpler and cheaper (**Synthesis**).

## 4. The changelog: status transitions and resolution

- `POST /rest/api/3/changelog/bulkfetch` "Returns a paginated list of all changelogs for given issues sorted by changelog date and issue IDs, starting from the oldest". "You can request the changelogs of up to 1000 issues and can filter them by up to 10 field IDs" [1].
  - Body: `issueIdsOrKeys` (max 1000), `fieldIds` (max 10, e.g. `["status","resolution","fixVersions","parent"]`), `maxResults` (default 1000, max 10000), and `nextPageToken` [1].
  - Response: `issueChangeLogs[]` holds `{issueId, changeHistories[]}`. Each history has `id`, `created`, `author` and `items[]`, and each item has `field`, `fieldId`, `fieldtype`, `from`, `fromString`, `to` and `toString` [1].
- The per-issue alternative is `GET /rest/api/3/issue/{key}/changelog`, offset-paged, oldest first, with `maxResults` defaulting to 100 [1].
- Scope: classic `read:jira-work`, or granular (beta) `read:issue-meta:jira`, `read:avatar:jira` and `read:issue.changelog:jira` [1].
- The status item gives status IDs in `from` and `to`. Map them to categories through the issue's status or `GET /rest/api/3/statuses` (**Synthesis**).
- **Data minimisation:** every change history carries an `author` (a user object). The connector should drop it on read, because the model never stores people ([Security](../design/architecture.md#security), item 2).
- **Synthesis, finish time:** take an issue's finish as its *last* transition into a Done-category status. If it later left Done, it is not finished. This handles reopen correctly and works in spaces without resolutions. `resolutiondate` is a cheap shortcut where workflows set and clear resolution reliably.
- **Synthesis, history:** the changelog goes back to the issue's creation, so typed counts can be proposed for periods before the tool was installed. Whether to offer that is a design question (see *Pre-installation history* in [architecture.md](../design/architecture.md#deferred-beyond-v1)).

## 5. Auth for a local app

### OAuth 2.0 (3LO) [2]

- Authorize at `https://auth.atlassian.com/authorize` with `audience=api.atlassian.com`, `client_id`, `scope`, `redirect_uri`, `state` ("required for security"), `response_type=code` and `prompt=consent`.
- Exchange the code at `https://auth.atlassian.com/oauth/token`. That call **requires `client_secret`**. "OAuth 2.0 (3LO) currently supports the code grant flow only." The page doesn't mention PKCE.
- The callback URL is set in the developer console, and `redirect_uri` "must match this URL". The page doesn't say whether `http://localhost` is allowed. **Unverified:** third-party reports conflict, and a 2021 Atlassian Community thread reports that the console would not save a localhost callback ([thread](https://community.atlassian.com/forums/Jira-questions/Why-can-t-I-update-the-callback-URL/qaq-p/1761234)). Test this in the console before relying on a loopback redirect.
- Refresh tokens need `offline_access` and **rotate**: each use returns a new one and disables the old. They expire after 90 days of inactivity, with a 10-minute reuse interval. A password change can return `403 invalid_grant`.
- After authorizing, call `GET https://api.atlassian.com/oauth/token/accessible-resources` to get the site's `cloudid`. API calls then go to `https://api.atlassian.com/ex/jira/{cloudid}/rest/api/3/…`, not `*.atlassian.net`.
- New apps are **private**: only the creator can use them. Sharing requires enabling distribution, and users of an unreviewed app see a warning.
- Scopes [3]: classic `read:jira-work` ("Read Jira project and issue data, search for issues…") covers every call above. Atlassian recommends classic scopes "Where available". `read:jira-user` isn't needed. Scopes don't override Jira permissions: the connector sees what the user can browse.
- Atlassian's Marketplace security requirements say 3LO "OAuth secrets must be stored encrypted and must not be made available in easily accessible locations" [9].

### API tokens

- Basic auth sends `email:api_token`. Atlassian recommends it "for simple scripts and manual calls" and OAuth 2.0 (3LO) for apps [10].
- **Scoped API tokens** exist: "We recommend you create an API token with scopes because it's more secure". Scoped tokens must call `https://api.atlassian.com/ex/jira/{cloudId}` [6]. Tokens expire after 1–365 days (1 year by default) [6].
- The Marketplace rules say "An application must not collect or store credentials belonging to Atlassian user accounts", such as user API tokens [9]. The 3LO auth page also says apps that "instruct customers to create individual 3LO apps don't comply" [10]. Both are framed for apps distributed to customers. This project's local, single-user server isn't a Marketplace app, but the rules show Atlassian's preferred direction.

**Synthesis, options for the local build:**

1. **Scoped API token** (`read:jira-work`, short expiry), pasted once and kept in the OS keychain. This is the simplest option. It needs no registered app, no client secret, no callback and no refresh logic, and its traffic is not on the points budget. The token is still a user credential. The architecture's Security section currently names 3LO; a scoped token meets its "read-only" intent, but not its letter.
2. **3LO with a project-registered app.** Shipping a client secret in a local app makes the secret public, and with no PKCE nothing replaces it. A localhost callback is unconfirmed. Not recommended until the callback question is tested.
3. **3LO with an app each user registers.** This works technically (each user holds their own secret), but Atlassian calls it non-compliant for distributed apps [10].

## 6. Rate limits and paging [5]

- Points-based quotas apply to Forge, Connect and **OAuth 2.0 (3LO)** apps, with "enforcement … beginning March 2, 2026". "API token-based traffic is not affected by this change" and stays under the burst limits only.
- Cost: "Each request starts with a base cost of 1 point, and additional points are added for each object involved". Core objects cost 1 each, identity and access objects 2 each. Atlassian's example: `GET /issue/ABC-123` costs 2 points.
- The default **global pool** is 65,000 points an hour, "shared across all tenants" of the app. A per-tenant pool is assigned only after Atlassian review. Quotas reset at the top of each UTC hour.
- Burst limits are per tenant and per endpoint: 100 requests a second for GET and POST by default.
- On a 429, read `Retry-After` and `RateLimit-Reason` (`jira-quota-global-based`, `jira-quota-tenant-based`, `jira-burst-based` or `jira-per-issue-on-write`). Use exponential backoff with jitter. `X-RateLimit-NearLimit: true` means less than 20% of the quota is left.
- Paging styles differ by endpoint: search and changelog bulkfetch use cursors (`nextPageToken`), while per-issue changelog and older endpoints use offsets (`startAt`/`maxResults`) [1].

## Cost of refreshing one milestone

**Synthesis**, for a milestone scoped by fix version with N tickets in scope (all states) since the start of history:

| Step | Requests | Points (3LO) |
|---|---|---|
| Search scope with `fields=status,resolution,resolutiondate,parent,issuetype,fixVersions` | ⌈N / page size⌉ (pages shrink with more fields; ~100 is a safe assumption, up to 5000 for `id` only) | 1 per page + N |
| Changelog bulkfetch, `fieldIds=["status"]` | ⌈N / 1000⌉ × pages of ≤10000 histories | 1 per page + histories (**Unverified** whether a changelog entry counts as an object) |
| Status categories / statuses (cacheable) | 1–2 | small |

For N = 300, that's about 3 search pages and 1 bulkfetch: **about 5 requests and up to roughly 1,000 points**. That is about 1.5% of the default hourly global pool. Many users of one shared 3LO app draw on the same 65,000 points, so per-user refreshes should be on demand, not on a timer. With an API token, no points apply. Tickets remaining needs no changelog: the same search answers it with `statusCategory != Done`.

An incremental refresh can add `AND updated >= "<last refresh>"` to fetch only issues that changed. Removals from scope (an issue's fix version taken off) won't show up that way, so a full re-read of IDs is still needed to catch them (**Synthesis**).

---

## Where Jira and GitHub differ (what a shared connector shape must absorb)

GitHub facts are from GitHub's REST docs [11]–[14]. All rows are **Synthesis** comparing the two.

| Concern | GitHub | Jira Cloud | What the shared shape absorbs |
|---|---|---|---|
| **Milestone scope** | A real milestone object, one per issue. `open_issues` and `closed_issues` come on the object, and you list issues with `?milestone=N&state=all` [12][13]. | No milestone object. A fix version (multi-valued, per project), epics via `parent`, or a JQL filter [4]. | The scope is a connector-specific selector. The connector returns plain items, never "a milestone". |
| **Finished** | Binary `state` `open` or `closed`, with `state_reason` `completed`, `not_planned`, `duplicate` or `reopened` [13]. | Status category Done, across many per-workflow statuses. Resolution is optional and absent in some spaces [4]. | Each item carries a normalised `done: boolean`, plus a "done but not completed" flag (not planned or Won't do) that the EM can include or exclude. |
| **Finish time** | `closed_at` on the issue [13]. A reopen and close moves it. | `resolutiondate`, or the last transition into Done from the changelog [1]. | Each item carries one `finishedAt` timestamp. Period bucketing by cadence happens once, outside the connector. |
| **History** | Issue timeline and events (separate calls per issue). | Bulk changelog for 1000 issues per call, full history [1]. | The connector exposes items with `finishedAt`, not raw history. |
| **Non-tickets in results** | Pull requests come back as issues ("GitHub's REST API considers every pull request an issue") [13]. | Subtasks (`hierarchyLevel = -1`) and epics (1) can match [4]. | The connector filters out non-tickets. The shape has no item kinds beyond "ticket", plus an optional parent ID. |
| **Hierarchy** | Sub-issues: `GET …/issues/{n}/sub_issues` and `…/parent`; the issue carries `sub_issues_summary` [13][14]. | `parent` field; Epic Link retired [4]. | Optional `parentId` on the item. |
| **Paging** | `page` and `per_page`, max 100 [12][13]. | Cursor `nextPageToken` (expires in 7 days), no total; per-issue changelog is offset-paged [1]. | Paging stays inside the connector. |
| **Consistency** | Not stated as eventually consistent in the pages read. | Search is eventually consistent [1][7]. | "Refreshed at" is shown. Seconds of lag are acceptable. |
| **Rate limits** | 5,000 requests an hour per user, shared with the user's other tokens and apps. Secondary limits: 100 concurrent requests, 900 points a minute [11]. | 3LO: points (1 + objects), 65,000 an hour in a global pool across all tenants. API tokens: burst limits only [5]. | The connector reports retry-after and backs off. Refresh is on demand. |
| **Auth for a local app** | OAuth apps allow a loopback redirect on any port ("does not need to match the port"), PKCE (`S256`), and a device flow that needs no client secret [15]. Fine-grained PATs can be read-only per repo. | 3LO needs a client secret and a fixed callback (localhost unconfirmed), with no PKCE documented [2]. Scoped API tokens expire in ≤1 year [6]. | The shape takes an opaque credential from the keychain. How it was obtained differs per tracker. |
| **Addressing** | `owner/repo`, on `api.github.com`. | Site `cloudId` (from accessible-resources), then a project key, on `api.atlassian.com/ex/jira/{cloudId}` [2][6]. | The connection config is per tracker: site plus project versus owner plus repo. |
| **Time zones** | ISO timestamps (UTC). | Timestamps with offsets; JQL dates are in the user's configured time zone [4]. | Bucket with timestamps, never JQL date ranges. |

---

## Open questions

- Does the Atlassian developer console accept an `http://localhost:<port>/callback` (or `127.0.0.1`) callback for a 3LO app today? Check it in the console.
- Does a changelog history entry count as an "object" in the points model [5]? This affects refresh cost, not feasibility.
- Is the per-issue cap on `expand=changelog` in search results stated anywhere? This doesn't matter if the connector uses bulkfetch.

## Sources

1. Atlassian, *Jira Cloud platform REST API v3*, OpenAPI spec: https://developer.atlassian.com/cloud/jira/platform/swagger-v3.v3.json (rendered: [Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/), [Issues](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)). Operations used: `/rest/api/3/search/jql`, `/search/approximate-count`, `/search` (deprecated), `/changelog/bulkfetch`, `/issue/{key}/changelog`, `/statuscategory`, `/project/{key}/versions`, `/version/{id}/unresolvedIssueCount`. Schemas used: `BulkChangelogRequestBean`, `SearchAndReconcileResults`, `ChangeDetails`, `Version` and `JiraStatus`.
2. Atlassian, *OAuth 2.0 (3LO) apps*: https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
3. Atlassian, *Scopes for OAuth 2.0 (3LO) and Forge apps*: https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
4. Atlassian Support, *JQL fields* (Jira Cloud): https://support.atlassian.com/jira-software-cloud/docs/jql-fields/
5. Atlassian, *Rate limiting* (Jira Cloud platform): https://developer.atlassian.com/cloud/jira/platform/rate-limiting/
6. Atlassian Support, *Manage API tokens for your Atlassian account*: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/
7. Atlassian, *Search and reconcile*: https://developer.atlassian.com/cloud/jira/platform/search-and-reconcile/
8. Atlassian Support, *JQL operators* (WAS, CHANGED): https://support.atlassian.com/jira-software-cloud/docs/jql-operators/
9. Atlassian, *Security requirements for cloud applications* (Marketplace): https://developer.atlassian.com/platform/marketplace/security-requirements/
10. Atlassian, *Basic auth for REST APIs*: https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/
11. GitHub Docs, *Rate limits for the REST API*: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
12. GitHub Docs, *REST API endpoints for milestones*: https://docs.github.com/en/rest/issues/milestones
13. GitHub Docs, *REST API endpoints for issues* (List repository issues): https://docs.github.com/en/rest/issues/issues#list-repository-issues
14. GitHub Docs, *REST API endpoints for sub-issues*: https://docs.github.com/en/rest/issues/sub-issues
15. GitHub Docs, *Authorizing OAuth apps*: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
