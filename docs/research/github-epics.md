# How GitHub can pick tickets by epic (sub-issues)

Research date: 2026-11-07. Question from the wayfinder ticket [How GitHub can pick tickets by epic (sub-issues)](https://github.com/random11235/forecaster-next-gen/issues/146), raised by the decision on [#136](https://github.com/random11235/forecaster-next-gen/issues/136#issuecomment-6622665128). Follows [github-connector.md](https://github.com/random11235/forecaster-next-gen/blob/research/github-connector/docs/research/github-connector.md) (branch `research/github-connector`).

**Question:** Can the read-only GitHub connector use epics (parent issues with sub-issues) to pick a milestone's tickets, with the milestone query kept as plain GitHub search syntax scoped to one repo? Covers the `parent-issue:` qualifier and its relatives, nested epics and leaf tickets, how `milestoneChoices()` can list epics by name, cost, and the token.

Citation convention: bracketed numbers refer to **Sources** at the end. **Observed** marks something checked with read-only `gh api` calls on 2026-11-07 against the private synthetic repo `random11235/forecaster-synthetic` (a user-owned repo), or against public `microsoft/vscode` where the synthetic repo has no example. **Synthesis** marks my own reasoning. **Unverified** marks a claim no source or call settles.

The synthetic repo has one small nested tree, used throughout: epic **#106** has sub-issues #107 and #111; #107 has sub-issues #108, #109, #110. So #106 has two direct children, one of them (#107) a parent itself, and four leaf tickets in all (#108–#111).

---

## Short answer

1. **Yes, search can select an epic's sub-issues**: `parent-issue:owner/repo#41` matches the issues whose parent is #41 [1] (**Observed** in the search API). GitHub documents the qualifier only for filtering Projects [1]; the issue-search docs don't list it [2][3].
2. **Use advanced search.** In GraphQL that is `search(type: ISSUE_ADVANCED, …)`, in REST `advanced_search=true` [4][5]. The default (legacy) search silently ignores `has:sub-issue` and `has:parent-issue` and matches everything, and in REST it rejects more than five `AND`/`OR`/`NOT` (**Observed**). Advanced search took 30 OR'd `parent-issue:` terms in a 1,602-character query (**Observed**).
3. **`parent-issue:` matches direct children only**, not the whole tree (**Observed**: `parent-issue:…#106` returned #107 and #111, not #108–#110). Reaching grandchildren takes one more search per level of nesting (up to eight levels [6]).
4. **A leaf is `no:sub-issue`** in the query, or `subIssuesSummary.total == 0` on the result (both **Observed**). `(parent-issue:R#106 OR parent-issue:R#107) no:sub-issue` returned exactly the four leaves.
5. **Epics for the picker:** `repo:R is:issue has:sub-issue <words>` (**Observed**; the qualifier is in GitHub's changelog [7]). Add `no:parent-issue` for top-level epics only. `type:Epic` works only where an organization defines an Epic issue type [3][8]; user-owned repos have none. Search matches **whole words, not prefixes**: `pay` and `pay*` find nothing, `payment` finds "payments" (**Observed**).
6. **Cost:** every search call cost **1 GraphQL point** (of 5,000 an hour), whether it returned 1 or 100 results with sub-issue fields (**Observed**). Whether REST search's 30 requests a minute also applies to GraphQL search is **Unverified**.
7. **Token:** a fine-grained token with repository **Issues: read** covers the sub-issue and parent endpoints [9]. Search needs no listed permission of its own [9] and returns only what the token can see. The calls here used an OAuth token (`repo` scope), so the fine-grained case is **Unverified** empirically.

**Recommendation (Synthesis):** pick an epic as `parent-issue:owner/repo#N` written in full, run every read through advanced search with `is:issue` and `no:sub-issue` added, and have the connector find any sub-epics under the picked epics so their leaves aren't silently missed (§3).

---

## 1. Selecting an epic's sub-issues with search

- **Syntax.** "`parent-issue:OWNER/REPO#ISSUE NUMBER` … `parent-issue:octocat/game#4` will show issues with issue #4 in octocat/game as their parent issue" [1]. That is from the Projects filtering page; neither "Searching issues and pull requests" [2] nor "Filtering and searching issues and pull requests" [3] lists it.
- **It works in the search APIs (Observed).** GraphQL `search(type: ISSUE_ADVANCED, query: "repo:random11235/forecaster-synthetic parent-issue:random11235/forecaster-synthetic#107")` returned #108, #109, #110. The same query in legacy GraphQL `ISSUE` search and REST `GET /search/issues` (with and without `advanced_search=true`) also returned them.
- **Only the full form works (Observed).** `parent-issue:#106` and `parent-issue:106` returned 0 results, with no error. `parent-issue:"random11235/forecaster-synthetic#106"` (quoted) works.
- **Combining epics (Observed).** In advanced search, `(parent-issue:R#106 OR parent-issue:R#107)` returns both sets. It combines with other qualifiers, e.g. `is:closed closed:>=…` and `no:sub-issue`, and negates: `-parent-issue:R#107` excluded #107's three children.
- **Query limits.** The REST search docs give a 256-character limit and at most five `AND`/`OR`/`NOT` [5]. **Observed:** that holds for legacy REST search ("More than five AND / OR / NOT operators were used."), and the legacy REST search returned 0 for the two-term OR query with parentheses, but advanced search (GraphQL `ISSUE_ADVANCED` and REST `advanced_search=true`) accepted 6, 12 and 30 OR'd `parent-issue:` terms, the longest 1,602 characters, and answered correctly. Parentheses nest at most five deep [3]. Several epics under one milestone therefore fits in one advanced query.
- **Advanced search is opt-in in the API.** GraphQL uses `ISSUE_ADVANCED`, REST `advanced_search=true`; the API "will remain opt-in" [4][10]. The schema lists `ISSUE`, `ISSUE_ADVANCED`, `ISSUE_HYBRID`, `ISSUE_SEMANTIC` [11]. In advanced search a space between `repo:`/`org:`/`user:` qualifiers is `AND` [4].

### Related qualifiers

| Qualifier | Advanced search | Legacy search | Source |
|---|---|---|---|
| `parent-issue:owner/repo#N` | direct children | direct children | [1]; Observed |
| `has:sub-issue` | issues with sub-issues (2 in the synthetic repo: #106, #107) | **ignored, matches everything** (139: all issues and PRs) | [7]; Observed |
| `no:sub-issue` / `-has:sub-issue` | issues without sub-issues (135 of 137) | works (135) | [7]; Observed |
| `has:parent-issue` | issues with a parent (5) | **ignored** (137) | Observed |
| `no:parent-issue` | issues without a parent (132) | works (132) | [7]; Observed |
| `has:sub-issues` (plural), `no:sub-issues`, `has:sub-issues-progress` | **ignored, no error** | ignored | Observed |
| `type:"Epic"` | issues of that organization issue type | Unverified | [1][3]; Observed (`type:Bug` 303 in `microsoft/vscode`; `type:Epic` 0 in the synthetic repo) |

- **Unknown `has:` values are silently dropped (Observed).** `has:nonsense` and `has:sub-issues` returned every issue, with no error. An unknown `key:value` qualifier (`foo:bar`) returned 0, also with no error. So a mistyped qualifier in a hand-edited milestone query isn't "rejected by the tracker" (#136): it widens or empties the match.
- `type:` in "Searching issues and pull requests" means issue or pull request [2]; the issue-type meaning is the one in the issues and Projects filters [1][3]. Both work in the same query (**Observed**).

## 2. If search couldn't: the GraphQL `subIssues` walk

Search can, so this is the fallback, and the tool for checking a tree.

- `Issue.subIssues` (connection, up to 100 a page), `Issue.parent`, `Issue.subIssuesSummary { total completed percentCompleted }` [11].
- **Observed:** `issue(number: 106) { subIssues(first: 100) { nodes { number state subIssuesSummary { total } subIssues(first: 100) { … } } } }` (two levels) cost 1 point. Three levels at `first: 100` was refused with `MAX_NODE_LIMIT_EXCEEDED` (1,000,000 possible nodes against the 500,000 limit [12]), so a deeper walk goes level by level or with smaller `first`.
- **`subIssuesSummary` counts direct children only (Observed):** #106 showed `total: 2, completed: 1` although it has four leaves, three of them closed.
- **Synthesis:** a walk makes the milestone a list of epic numbers rather than a query, which breaks "the milestone query is plain GitHub search" and the hand-edit path. Labels or issue types by convention keep a query but rely on the team's discipline. With `parent-issue:` available, neither is needed.

## 3. Nested epics and leaf tickets

- **Direct children only (Observed):** `parent-issue:R#106` returned #107 and #111; #108–#110 (children of #107) were missing.
- GitHub allows "up to 100 sub-issues per parent" and "up to eight levels of nested sub-issues" [6].
- **Leaf test:** `no:sub-issue` in the query (**Observed**), or `subIssuesSummary.total == 0` on each result [11] (**Observed**). This matches the glossary's **finished** rule: "Only tickets with no children of their own are counted". It reads the tree as it is now: an issue whose sub-issues were all removed counts as a leaf again.
- **Reaching grandchildren, one search per level (Observed, Synthesis):**
  1. `repo:R is:issue (parent-issue:R#106) has:sub-issue` → #107 (the sub-epics).
  2. Repeat for the new parents until none come back (at most eight levels [6]); each search cost 1 point.
  3. Leaves: `repo:R is:issue (parent-issue:R#106 OR parent-issue:R#107) no:sub-issue` → #108, #109, #110, #111.
- **Synthesis, keeping the query plain:** the query a user sees and edits should be what runs. Two ways fit that:
  - **The picker writes the tree.** Picking #106 adds `parent-issue:R#106 OR parent-issue:R#107`, shown as one chip "#106 Payment methods (epic)". Plain and pasteable into GitHub, but stale when a sub-epic is added later.
  - **The read flags missing sub-epics.** On each read, the connector runs step 1 for the query's `parent-issue:` terms (a point or two) and, if a sub-epic isn't in the query, raises a problem flag with "Add its tickets". This keeps the query literal and catches the stale case.
  Using both is cheap. Rewriting the query silently at read time (treating `parent-issue:` as "whole tree") would make the tool disagree with GitHub's own results for the same text.
- **Cross-repo sub-issues:** GitHub lets a parent take sub-issues from other repositories [6]. The connection's `repo:` scope excludes them (**Synthesis**; not tested, the synthetic repo has none).

## 4. Listing epics for the picker (`milestoneChoices()`)

- **Query:** `repo:R is:issue has:sub-issue <typed words>` in advanced search (**Observed**: "payment" returned #106 and #107; "106" returned #106 by number). Add `no:parent-issue` to list top-level epics only (**Observed**: returns #106, not #107). `is:open` keeps finished epics out if wanted. `in:title` limits matching to titles [2].
- **What counts as an epic.** `has:sub-issue` works in every repo. `type:"Epic"` works only where the organization defines that type [3][8], and user-owned repos have no issue types (github-connector.md §3). An Epic-typed issue with no sub-issues yet has no tickets to pick, so `has:sub-issue` loses nothing a forecast needs (**Synthesis**).
- **Whole words only (Observed).** `pay` and `pay*` matched nothing; `payment` matched "payments" (stemmed). A find-as-you-type picker gets results only once a whole word is typed. If prefix matching matters, the alternative is one paged `has:sub-issue` search per repo (100 a page, 1 point) filtered on the client: `microsoft/vscode` has 44 issues with sub-issues, 20 of them open top-level (**Observed**). That lists something up front, which #136 ruled out for cost; but the list is parents only, usually small.
- **Cost:** 1 point a call (**Observed**, every search here, including 100 results with `parent`, `subIssuesSummary`, `closedAt`, `stateReason`). GraphQL allows 5,000 points an hour and 2,000 a minute [12]. REST search allows 30 requests a minute [5]; whether that also caps GraphQL `search` isn't documented (**Unverified**), so the picker should debounce.

## 5. Token

- Fine-grained token, repository **Issues: read**: `GET /repos/{owner}/{repo}/issues/{n}/sub_issues` (read) and `GET …/issues/{n}/parent` (read) [9]. GraphQL `subIssues`/`parent` read the same data (**Synthesis**).
- `GET /search/issues` isn't listed under any permission [9]; search returns only issues in repos the token can read (**Synthesis**).
- For GitHub Apps with a user access token, an issues search without `is:issue` or `is:pull-request` is refused with HTTP 422 [5]. The connector should always add `is:issue`, which also keeps pull requests out.
- **Unverified empirically:** every call here used the `gh` OAuth token (`repo` scope), not a fine-grained token.

## Consequences for the #136 decision

- `parent-issue:owner/repo#41` is right, but **only in its full form** and best through **advanced search**. The picker must write the full form, and hand edits like `parent-issue:#41` should be flagged, since GitHub returns 0 without error.
- **Nested epics** aren't covered by one `parent-issue:` term. The decision needs one of §3's two answers (the picker writes the tree, and/or a flag for missing sub-epics).
- **"Rejected by the tracker" won't catch typos** in `has:` qualifiers (silently ignored) or unknown qualifiers (silently 0). The connector can check qualifiers against a known list itself.
- **The 256-character and five-operator limits don't bind** in advanced search, so OR'ing several epics is fine.
- **The names-only lookup matches whole words**, not prefixes. Either accept it (results appear after a word is typed) or list a repo's parents once and filter locally.
- The read adds `is:issue` and `no:sub-issue` to the milestone query, so parents and pull requests never count.

---

## Sources

1. GitHub Docs. "Filtering projects": "Filtering by parent issue" (`parent-issue:OWNER/REPO#ISSUE NUMBER`) and "Filtering by issue type". https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project/filtering-projects
2. GitHub Docs. "Searching issues and pull requests" (no parent or sub-issue qualifiers; `type:` = issue or PR; `in:title`). https://docs.github.com/en/search-github/searching-on-github/searching-issues-and-pull-requests
3. GitHub Docs. "Filtering and searching issues and pull requests" (`type:"Bug"` for organizations using issue types; `AND`/`OR`, parentheses five levels deep). https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests
4. GitHub Changelog, 2025-03-06. "GitHub Issues & Projects: API support for issues advanced search and more" (`advanced_search`, `ISSUE_ADVANCED`). https://github.blog/changelog/2025-03-06-github-issues-projects-api-support-for-issues-advanced-search-and-more/
5. GitHub Docs. "REST API endpoints for search" (30 requests a minute; 256 characters and five operators; `advanced_search`; 422 without `is:issue` for app user tokens). https://docs.github.com/en/rest/search/search
6. GitHub Docs. "Adding sub-issues" (100 per parent, eight levels, other repositories). https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues
7. GitHub Changelog, 2024-12-12. "GitHub Issues & Projects: close issue as a duplicate, REST API for sub-issues, and more" (`no:parent-issue`, `has:sub-issue`, `no:type`). https://github.blog/changelog/2024-12-12-github-issues-projects-close-issue-as-a-duplicate-rest-api-for-sub-issues-and-more/
8. GitHub Docs. "Managing issue types in an organization". https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-types-in-an-organization
9. GitHub Docs. "Permissions required for fine-grained personal access tokens" (Issues: sub-issues and parent endpoints). https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
10. GitHub Changelog, 2025-07-17. "Duplicate issues, create from anywhere, and more" (API advanced search remains opt-in). https://github.blog/changelog/2025-07-17-duplicate-issues-create-from-anywhere-and-more/
11. GitHub. Public GraphQL schema (`schema.docs.graphql`), fetched 2026-11-07: `SearchType`, `Issue.subIssues`, `Issue.parent`, `SubIssuesSummary`. https://docs.github.com/public/fpt/schema.docs.graphql
12. GitHub Docs. "Rate limits and query limits for the GraphQL API" (5,000 points an hour, 2,000 a minute, minimum cost 1, 500,000 nodes). https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api
