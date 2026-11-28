# src/

Each folder here is a **module**: `app/`, `connectors/`, `engine/`, `forecast/`, `ledger/`, `model/`, `secrets/`, `storage/`. What each one may import from the others is in [`docs/design/architecture-dependency-rules.md`](../docs/design/architecture-dependency-rules.md).

## Layout

- A module's **entry points** are the files at its root, such as `connectors/github.ts` or `storage/sqliteStorage.ts`. `engine/` and `forecast/` each have one, `index.ts`, which says all the module offers (`engine/` has a second, `random.ts`, for its reference vectors' test).
- Its implementation lives in **subfolders**, such as `forecast/lib/`, `storage/lib/` or a connector's own folder (`connectors/github/`). A subfolder is private to its module.

The factory, which builds tickets with an agent, is not part of the app: it is its own module, `factory/` at the repo's root ([`docs/agents/factory.md`](../docs/agents/factory.md#the-module)). It imports nothing from `src/`, `scripts/` or `test/`, and none of them imports it.

## The rule

**Import a module only through its root files.** Code outside a module (`test/`, `scripts/`, another module) imports its entry points, never a file in one of its subfolders. A module's own files import each other freely. There are no dependency cycles.

`npm run lint:boundaries` checks this with dependency-cruiser ([`.dependency-cruiser.cjs`](../.dependency-cruiser.cjs), run by [`scripts/lintBoundaries.ts`](../scripts/lintBoundaries.ts)) over `src`, `test`, `scripts` and `factory`. It runs in `npm run check` and in CI beside the typecheck, and fails on a violation, naming the rule and the import, or on a run that cruises no modules. To fix a violation, import what you need from the module's entry point, or give the module a new entry point at its root that exports it.

Prefer several small entry points to one barrel `index.ts`: each says what it offers by its name, and importing one loads only what it needs rather than the whole module. A module whose interface is one thing, such as `engine/`'s simulation or `forecast/`'s team handle, has an `index.ts` that exports that interface and its types, the rest kept in `lib/`.
