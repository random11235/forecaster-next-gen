---
status: accepted
---

# A team has one connection, to one repo or Jira project

A team connects at most one tracker, GitHub or Jira, and names one repo or one Jira project in it. The connector adds that scope to every milestone query and comparable-work query, and shows a query that reaches outside it (another `repo:`, `org:` or Jira project) as an error rather than quietly narrowing it. So a query typed by hand can't count tickets from elsewhere in the tracker, and a milestone and its comparable work always count from the same tickets. The cost: a team whose milestone spans several repos or Jira projects can't forecast it from a connection, and has to type its pace instead.

## Considered Options

- **Several repos or projects per connection.** Left for later: one scope is enough for the teams we know of, and every connector can enforce it the same way.
- **No scope: the query alone says where tickets come from.** Rejected: a mistyped query could quietly count another team's tickets, and the forecast would look fine.

## Consequences

- Adding several scopes later changes the `Connection` type, how every connector adds and enforces its scope (`outOfScope`), and the connector contract suite (Seam C).
- Comparable work from another repo or project, such as similar work done by another team, can't be pointed at.
