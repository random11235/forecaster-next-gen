# Coding standards

## Keep modules deep

Judge each new or changed module with the `/codebase-design` skill's vocabulary (deep and shallow modules, seams, leverage). Flag a shallow module whose interface is nearly as large as what it hides, and logic split across modules that change together.

## Put wrappers inside the module

A decorator, guard or overlay that every caller must remember to apply is used once, inside the module that owns the behaviour. One missed call site is a silent bug.

## Treat stored shapes as one-way doors

Stored shapes (schema steps, persisted JSON) outlive the branch. Flag: implicit state inferred from what happens to be stored, unvalidated blobs, and backfills that leave existing data in a state the new code misreads.

## Add a change file with the right bump

The change file a PR adds, and the bump it sets, are checked by `check:changes` ([`scripts/changeFiles.ts`](scripts/changeFiles.ts)). [`docs/agents/pull-requests.md`](docs/agents/pull-requests.md#version) says which bump a change needs, including what the check can't see.

## Don't use `any` or `!`

`any` and `!` are checked by [`test/typeCheckRules.test.ts`](test/typeCheckRules.test.ts). Its header says how to fix what it finds.

## Keep files under 5000 tokens

Keep every file under 5000 tokens. `check:changes` checks it ([`scripts/fileSize.ts`](scripts/fileSize.ts)) and says how to split a file that's over.
