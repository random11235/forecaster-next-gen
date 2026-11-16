# Architecture: Security

Part of the architecture design; the index is [`architecture.md`](architecture.md).

v1 is a local, single-user tool, so items 1 to 3 are what matter. Items 4 and 5 still apply; the rest becomes relevant only with a hosted or multi-team version.

1. **Ticketing credentials.**
   - Use read-only access: for Jira, a scoped API token with read-only scopes (`read:jira-work`) that expires, sent as basic auth with its account's email through Atlassian's gateway; OAuth 2.0 (3LO) with read scopes may replace it later. For GitHub, a GitHub App or fine-grained token with read-only issue access. A classic (unscoped) API token or PAT carries all of that user's permissions, including write access.
   - Store tokens in the OS keychain, through `secrets/`, keyed by team. Never put them in the browser, `localStorage`, the SQLite file, logs or error messages. Nothing but `secrets/` holds a token: it goes from there to the connector when the connector is built. A keychain failure drops the keychain's own error, which might quote the token.
   - No webhooks in v1. Connectors poll on refresh.
2. **Data minimisation.** The model needs only IDs, types, parent links, labels, status timestamps and counts. Don't ingest titles (except epics', which name them on screen), descriptions, comments or assignee identities. Capacity is typed for the team as a whole, so there is no `Person` table.
3. **The local server checks who is asking.** It listens on `127.0.0.1` only, but localhost is reachable from any page the EM's browser opens: a form on any site can POST to it (the port is fixed, so it needn't search), and a page on a domain re-pointed at `127.0.0.1` (DNS rebinding) is same-origin with it in the browser's eyes, so could read every page and run reads with the saved token. So `serve()` in `app/launch.ts`, before any route runs, refuses with a `403`:
   - any request whose `Host` isn't `127.0.0.1:<port>` or `localhost:<port>`, which stops DNS rebinding: the rebound request carries the attacker's domain as its `Host`;
   - any POST whose `Origin` isn't `http://127.0.0.1:<port>` or `http://localhost:<port>`, or has none: browsers send `Origin` on every POST, the app's own save-in-place `fetch` among them.

   `<port>` is the port the server actually bound, so a `PORT=0` launch works. GETs aren't `Origin`-checked, so links, bookmarks, typed URLs and `/live` keep working. There is no session token or cookie: with `Origin` checked it isn't needed, and a `SameSite=Strict` cookie would break links opened from other apps.

4. **Engine input limits.**
   - Cap `trials`, sample-array sizes, `maxPeriods` and the number of epics in `scope` (100, `MAX_EPICS`) in `forecast/buildCase.ts`, and check them again at the engine boundary. The epic cap is a memory guard: the engine keeps a finish period per epic per trial.
   - The PRNG does **not** need to be cryptographic. A fast seeded PRNG is correct.
5. **Dependencies.**
   - Keep `engine/` free of dependencies.
   - Commit a lockfile and run `npm audit` or Dependabot.
   - TypeScript and Rust/WASM are both memory-safe, so the language choice doesn't change the security picture.
6. **Later, for hosted or multi-team use:**
   - Scope every query by team. Aggregators and stakeholders see summaries only, never item-level data.
   - Encrypt tokens at rest server-side, and verify webhook signatures.
   - The forecast ledger is append-only, with `createdBy` recorded. Calibration numbers mean nothing if old forecasts can be edited.
