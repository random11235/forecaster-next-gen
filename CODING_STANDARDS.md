# Coding standards

## Add a change file with the right bump

The change file a PR adds, and the bump it sets, are checked by `check:changes` ([`scripts/changeFiles.ts`](scripts/changeFiles.ts)). [`docs/agents/pull-requests.md`](docs/agents/pull-requests.md#version) says which bump a change needs, including what the check can't see.

## Don't use `any` or `!`

`any` and `!` are checked by [`test/typeCheckRules.test.ts`](test/typeCheckRules.test.ts). Its header says how to fix what it finds.

## Keep files under 5000 tokens

Keep every file under 5000 tokens. `check:changes` checks it ([`scripts/fileSize.ts`](scripts/fileSize.ts)) and says how to split a file that's over.
