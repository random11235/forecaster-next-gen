#!/usr/bin/env bash
# Sets each issue's Status on the project board (https://github.com/users/random11235/projects/3) from the issue
# itself, so the board follows the Ticket lifecycle (docs/agents/issue-tracker.md) without anyone dragging cards:
#
#   closed                                  -> Done
#   open, with an open PR that closes it    -> In review
#   open, labelled in-progress              -> In progress
#   open, labelled ready-for-agent          -> Ready
#   open, none of those                     -> Backlog, but only from a status one of the rules above set (work
#                                              stopped, a PR closed unmerged, the issue reopened); a card someone put
#                                              in Ready or Backlog by hand stays there
#
# The board's built-in automations can't do this alone: none reads labels, and "Pull request linked to issue" moves a
# closed ticket back to In progress when an integration PR's `Closes #n` names it, which no later event undoes.
# .github/workflows/board.yml runs this on every issue and PR event; it also runs by hand (`scripts/syncBoard.sh`)
# with a gh login that has the `project` scope. It reads the whole board and changes only the cards that are wrong.
set -euo pipefail

OWNER=random11235
NUMBER=3

items=$(gh api graphql --paginate -F owner="$OWNER" -F number="$NUMBER" -f query='
query($owner: String!, $number: Int!, $endCursor: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      items(first: 100, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            ... on Issue {
              number
              state
              labels(first: 20) { nodes { name } }
              closedByPullRequestsReferences(first: 10) { nodes { state } }
            }
          }
        }
      }
    }
  }
}' --jq '.data.user.projectV2.items.nodes[]
  | select(.content.number != null)
  | [.id, .content.number, (.status.name // ""),
     (if .content.state == "CLOSED" then "Done"
      elif any(.content.closedByPullRequestsReferences.nodes[]; .state == "OPEN") then "In review"
      elif any(.content.labels.nodes[]; .name == "in-progress") then "In progress"
      elif any(.content.labels.nodes[]; .name == "ready-for-agent") then "Ready"
      elif (.status.name // "") | IN("Ready", "Backlog") then .status.name
      else "Backlog" end)]
  | @tsv')

fields=$(gh api graphql -F owner="$OWNER" -F number="$NUMBER" -f query='
query($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } }
    }
  }
}')
project_id=$(jq -r '.data.user.projectV2.id' <<<"$fields")
field_id=$(jq -r '.data.user.projectV2.field.id' <<<"$fields")

changed=0
while IFS=$'\t' read -r item issue current wanted; do
  [[ -z "$item" || "$current" == "$wanted" ]] && continue
  option=$(jq -r --arg name "$wanted" '.data.user.projectV2.field.options[] | select(.name == $name) | .id' <<<"$fields")
  gh project item-edit --project-id "$project_id" --id "$item" --field-id "$field_id" \
    --single-select-option-id "$option" >/dev/null
  echo "#$issue: ${current:-no status} -> $wanted"
  changed=$((changed + 1))
done <<<"$items"
echo "$changed card(s) moved"
