# Coding standards

## Add a change file with the right bump

The change file a PR adds, and the bump it sets, are checked by `check:changes` ([`scripts/changeFiles.ts`](scripts/changeFiles.ts)). [`docs/agents/pull-requests.md`](docs/agents/pull-requests.md#version) says which bump a change needs, including what the check can't see.

## Don't use `any` or `!`

`any` and `!` are checked by [`test/typeCheckRules.test.ts`](test/typeCheckRules.test.ts). Its header says how to fix what it finds.

## Keep files under 5000 tokens

Keep every file under 5000 tokens. `check:changes` checks it ([`scripts/fileSize.ts`](scripts/fileSize.ts)) and says how to split a file that's over.

## Rules of thumb

No check can enforce these. They say what we mean to do: apply them in review, and say so when a change departs from one.

### Keep modules deep

Judge each new or changed module with the `/codebase-design` skill's vocabulary (deep and shallow modules, seams, leverage). Flag a shallow module whose interface is nearly as large as what it hides, and logic split across modules that change together. `lint:boundaries` checks the mechanical half (root entry points, private subfolders), and the CI summary lists the shallowest entry points ([`scripts/moduleDepth.ts`](scripts/moduleDepth.ts)).

### Put wrappers inside the module

A decorator, guard or overlay that every caller must remember to apply is used once, inside the module that owns the behaviour. One missed call site is a silent bug.

### Keep tests lean

A test's title states one behaviour in about 100 characters: what goes in and what comes out. Context the cases share goes in the `describe`, and a `test.each` title names its case rather than printing its whole input. Flag a change whose added test lines are more than three times its added source lines, and name the tests that overlap: two tests pinning one behaviour through different seams, or a case table whose rows exercise the same branch.

### Keep seam docs to seams

The test-seam docs (`docs/design/architecture-test-seams*.md`) name each seam and how its tests drive it. Flag an edit to one that doesn't add, remove or change a seam: a sentence saying what one ticket's test checks (a note's wording, a link's target) restates the test, and goes stale with the next copy change.

### Treat stored shapes as one-way doors

Stored shapes (schema steps, persisted JSON) outlive the branch. Flag implicit state inferred from what happens to be stored, and backfills that leave existing data in a state the new code misreads. Checks cover the rest: stored values are frozen by a snapshot ([`test/storage/storedValues.test.ts`](test/storage/storedValues.test.ts)), stored JSON is read through one checked parser ([`test/storedJsonRules.test.ts`](test/storedJsonRules.test.ts)), and every migration step has a pre-migration test ([`test/storage/migrationCoverage.test.ts`](test/storage/migrationCoverage.test.ts)).
