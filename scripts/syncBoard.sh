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
# It also sets each open card's Health, a red/amber/green read of whether it needs someone:
#
#   Red     parked; a failing check on an open PR that closes it; or in progress longer than the board's 95th
#           percentile cycle time
#   Amber   waiting on a person (needs-triage, needs-info, ready-for-human); an open PR older than a day; or in
#           progress longer than the 85th percentile
#   Green   any other open card
#
# Cycle time runs from the last time in-progress was added to the close, or, for a spec's ticket, which stays open,
# to its `merged` comment: the factory's `merged into spec/<n>` after its mark, or /implement-spec's `merged`. A
# ticket merged that way, an epic and a closed card have no Health. With fewer than 5 finished tickets on the board
# there are no percentiles, and age makes nothing red or amber. A board without a single-select Health field
# (options Red, Amber, Green) gets Status only.
#
# And it takes ready-for-agent and in-progress off a closed issue, as the Ticket lifecycle says to on close.
#
# The board's built-in automations can't do this alone: none reads labels, and "Pull request linked to issue" moves a
# closed ticket back to In progress when an integration PR's `Closes #n` names it, which no later event undoes.
# .github/workflows/board.yml runs this on every issue and PR event and daily, which is what ages Health; it also runs
# by hand (`scripts/syncBoard.sh`, or `--dry-run` to print what it would change) with a gh login that has the
# `project` scope. It reads the whole board and changes only the cards that are wrong.
set -euo pipefail

OWNER=random11235
NUMBER=3
MARK='<!-- forecaster-factory -->' # FACTORY_MARK in factory/factoryTrust.ts
DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

pages=$(gh api graphql --paginate -F owner="$OWNER" -F number="$NUMBER" -f query='
query($owner: String!, $number: Int!, $endCursor: String) {
  user(login: $owner) {
    projectV2(number: $number) {
      items(first: 50, after: $endCursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          health: fieldValueByName(name: "Health") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content {
            ... on Issue {
              number
              state
              closedAt
              repository { nameWithOwner }
              labels(first: 20) { nodes { name } }
              timelineItems(last: 20, itemTypes: [LABELED_EVENT]) {
                nodes { ... on LabeledEvent { createdAt label { name } } }
              }
              comments(last: 20) { nodes { createdAt body } }
              closedByPullRequestsReferences(first: 10) {
                nodes { state createdAt commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
              }
            }
          }
        }
      }
    }
  }
}')

# One row per card: item id, issue, repo, Status now and wanted, Health now and wanted, labels to take off
rows=$(jq -rs --arg mark "$MARK" '
  def p(q): if length < 5 then null else sort | .[(q * (length - 1)) | floor] end;
  [.[].data.user.projectV2.items.nodes[] | select(.content.number != null)]
  | map(.content as $c
      | ($c.labels.nodes | map(.name)) as $labels
      | ([$c.timelineItems.nodes[] | select(.label.name == "in-progress") | .createdAt | fromdateiso8601]
         | max) as $start
      | ([$c.comments.nodes[]
          | (.body | gsub("^\\s+"; "")) as $text
          | select(($text | startswith($mark) and (.[($mark | length):] | test("^\\s*merged into spec/"; "i")))
                   or ($text | test("^merged\\s*$"; "i")))
          | .createdAt | fromdateiso8601] | min) as $merged
      | . + {labels: $labels, start: $start, merged: $merged,
             end: (if $c.state == "CLOSED" then ($c.closedAt | fromdateiso8601) else $merged end)})
  | ([.[] | select(.start != null and .end != null and .end > .start) | .end - .start]) as $cycles
  | ($cycles | p(0.85)) as $p85 | ($cycles | p(0.95)) as $p95
  | .[]
  | .content as $c
  | ([$c.closedByPullRequestsReferences.nodes[] | select(.state == "OPEN")]) as $prs
  | (if .start != null and ($c.labels.nodes | any(.name == "in-progress")) then now - .start else null end) as $age
  | [.id, $c.number, $c.repository.nameWithOwner, (.status.name // ""),
     (if $c.state == "CLOSED" then "Done"
      elif ($prs | length) > 0 then "In review"
      elif (.labels | index("in-progress")) then "In progress"
      elif (.labels | index("ready-for-agent")) then "Ready"
      elif (.status.name // "") | IN("Ready", "Backlog") then .status.name
      else "Backlog" end),
     (.health.name // ""),
     (if $c.state == "CLOSED" or .merged != null or (.labels | index("epic")) then ""
      elif (.labels | index("parked"))
        or ($prs | any(.commits.nodes[0].commit.statusCheckRollup.state // "" | IN("FAILURE", "ERROR")))
        or ($p95 != null and $age != null and $age > $p95) then "Red"
      elif (.labels | any(IN("needs-triage", "needs-info", "ready-for-human")))
        or ($prs | any(now - (.createdAt | fromdateiso8601) > 86400))
        or ($p85 != null and $age != null and $age > $p85) then "Amber"
      else "Green" end),
     (if $c.state == "CLOSED" then [.labels[] | select(IN("ready-for-agent", "in-progress"))] | join(",") else "" end)]
  | map(tostring) | join("\u001f")' <<<"$pages")

fields=$(gh api graphql -F owner="$OWNER" -F number="$NUMBER" -f query='
query($owner: String!, $number: Int!) {
  user(login: $owner) {
    projectV2(number: $number) {
      id
      fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
    }
  }
}' --jq '{id: .data.user.projectV2.id,
  fields: [.data.user.projectV2.fields.nodes[] | select(.name != null) | {key: .name, value: .}] | from_entries}')
project_id=$(jq -r '.id' <<<"$fields")
status_id=$(jq -r '.fields.Status.id' <<<"$fields")
health_id=$(jq -r '.fields.Health.id // ""' <<<"$fields")
[[ -z "$health_id" ]] && echo "no Health field on the board: setting Status only"

# Sets one card's single-select field to an option by name, or clears it when the name is empty
set_field() {
  local item=$1 field=$2 key=$3 name=$4
  $DRY_RUN && return
  if [[ -z "$name" ]]; then
    gh api graphql -f project="$project_id" -f item="$item" -f field="$field" -f query='
mutation($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field}) { projectV2Item { id } }
}' >/dev/null
    return
  fi
  local option
  option=$(jq -r --arg key "$key" --arg name "$name" '.fields[$key].options[] | select(.name == $name) | .id' \
    <<<"$fields")
  # a plain mutation, not `gh project item-edit`: that one also demands read:org and read:discussion, which a token
  # with only the project scope lacks. -f, not -F: -F sends an all-digit option id (Done's is one) as a number
  gh api graphql -f project="$project_id" -f item="$item" -f field="$field" -f option="$option" -f query='
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {projectId: $project, itemId: $item, fieldId: $field,
                                        value: {singleSelectOptionId: $option}}) { projectV2Item { id } }
}' >/dev/null
}

changed=0
# \x1f, not a tab: read collapses runs of a whitespace separator, so a card with no status would shift its columns
while IFS=$'\x1f' read -r item issue repo current wanted health_now health strip; do
  [[ -z "$item" ]] && continue
  if [[ "$current" != "$wanted" ]]; then
    set_field "$item" "$status_id" Status "$wanted"
    echo "#$issue: ${current:-no status} -> $wanted"
    changed=$((changed + 1))
  fi
  if [[ -n "$health_id" && "$health_now" != "$health" ]]; then
    set_field "$item" "$health_id" Health "$health"
    echo "#$issue: Health ${health_now:-none} -> ${health:-none}"
    changed=$((changed + 1))
  fi
  if [[ -n "$strip" ]]; then
    $DRY_RUN || gh issue edit "$issue" --repo "$repo" --remove-label "$strip" >/dev/null
    echo "#$issue: closed, so took off $strip"
    changed=$((changed + 1))
  fi
done <<<"$rows"
echo "$changed change(s)$($DRY_RUN && echo ', dry run: nothing written')"
