# Architecture: Dependency rules and file types

Part of the architecture design; the index is [`architecture.md`](architecture.md).

**Dependency rules:**

- Each folder of `src/` is a module whose entry points are the files at its root; its subfolders (`lib/`, a connector's own folder) are private to it. Code outside a module (`test/`, `scripts/`, another module) imports only its entry points, a module's own files import each other freely, and there are no dependency cycles. `npm run lint:boundaries` (dependency-cruiser, [`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs)) checks this over `src`, `test`, `scripts` and `factory`, in `check:static` beside the typecheck, and fails on a run that cruises no modules. [`src/README.md`](../../src/README.md) sets out the layout. Each rule below that says so is a named rule there too, checked the same way: it sees side-effect imports and dynamic `import()` as well, and an `import type` counts unless a rule says otherwise. `test/scripts/lintBoundaries.test.ts` and `lintBoundaries.layering.test.ts` show each rule failing on an import that breaks it.
- `engine/` imports nothing from the rest of the app. `.dependency-cruiser.cjs` checks this rule.
- `model/` depends only on `engine/`'s types (`import type` of `engine/index.ts`), never on `connectors/`: the record types a connector answers in (`Ticket`, `Choice`, `Failure`) live in `model/`, and `connectors/connector.ts` re-exports them. `.dependency-cruiser.cjs` checks this rule.
- `samples/` imports only `model/`.
- `forecast/` is the only module that depends on both stored data and `engine/`'s code: it runs the engine on stored inputs. `storage/` reaches only its types (below).
- `ledger/` depends only on `engine/`'s types (`import type`).
- `storage/` keeps the ledger, and reaches the engine only for its types (`import type`), to check each logged forecast's case and result as it reads them back (`storage/lib/forecastLogJson.ts`); it runs nothing of the engine. `.dependency-cruiser.cjs` checks both rules, and `model/`'s, as one rule that `model/`, `ledger/` and `storage/` reach `engine/` only with `import type`.
- `app/` reaches forecasts through `forecast/`, never `engine/` directly, not even its types. `.dependency-cruiser.cjs` checks this rule.
- Forecast code reads facts only through team facts (`teamFacts`), never `storage.facts`, so a forecast always sees the EM's status mapping. Storage and storage tests may still read raw facts. (The MVP reads no facts: it has neither, until connectors return.)
- `connectors/`, `storage/` and `secrets/` sit at the edges behind interfaces, so v1 can run from canned data and the same code can be hosted later.
- `connectors/` import only their shared types (`connectors/connector.ts`), what the network connectors share (`connectors/remote.ts`), files in their own connector's folder, and `model/`. Each concrete connector has an entry point at the root of `connectors/` (`canned.ts`, `github.ts`, `jira.ts`), whose own folder is its connector's: it imports that folder, never another entry point, and exports only what outside code uses.
- Outside `connectors/`, code in `src/`, `test/` and `scripts/` reaches a concrete connector only through its entry point, never a file in `canned/`, `github/` or `jira/`.
- `forecast/` depends on the connector interface only, never on a concrete connector (`canned/`, `github/` or `jira/`, or their entry points). `app/` builds the connector and passes it in: the canned one from its synthetic fixture in demo mode (`FORECASTER_DEMO=1`), otherwise the real one for the connection. `.dependency-cruiser.cjs` checks these rules.
- `secrets/` imports nothing from the rest of the app. Only `app/` builds a `Secrets` (the keychain in the local server build) and passes it in; `forecast/` imports only the interface (`secrets/secrets.ts`); nothing else imports `secrets/`. The browser build's page script (`app/webMain.ts`) loads nothing from `secrets/`: an `import type` of the interface is all it may reach. `.dependency-cruiser.cjs` checks these rules too, following every import from the page script, `import type` among them, and allowing only `secrets/secrets.ts`, which holds only types, so `verbatimModuleSyntax` makes any import of it an `import type`.
- The factory (`factory/`, [`docs/agents/factory.md`](../agents/factory.md)) and the app (`src/`, `scripts/` and `test/`) import nothing from each other, so the factory stays separable from the app. The factory may import Sandcastle and Node's built-ins. `.dependency-cruiser.cjs` checks this rule both ways.
- Only `forecast/lib/appVersion.ts` imports `package.json`, for the app's version. The web build (`scripts/buildWeb.ts`) gives the page it shares a `package.json` of the version alone, none of its scripts or dependencies, so any other importer would get only that. `.dependency-cruiser.cjs` checks this rule too.

**File types:**

- Source is `.ts`.
- Tests are `.test.ts`.
- Fixtures are `.json`, in the same shape a connector produces (or the raw API response, for connector replay tests).
- Settings defaults are a typed `.ts` constant.
