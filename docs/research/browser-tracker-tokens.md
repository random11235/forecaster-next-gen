# Getting and keeping a GitHub credential in the web build

Research date: 2026-11-28. Scope: how an EM using the Forecaster's static web build (GitHub Pages at `random11235.github.io/forecaster-next-gen/`, or a single HTML file opened from `file://`) can get a read-only GitHub credential for one repo's Issues, and keep it between visits, with no server. It covers GitHub's sign-in flows (OAuth app, GitHub App, device flow), pre-filled fine-grained PAT links, PAT policies, the IETF best practice for browser apps, OWASP guidance, encrypting tokens in the browser, and the origin risks of GitHub Pages and `file://`. Session-only storage has already been rejected. The current rule in [architecture-security.md](../design/architecture-security.md) is "Never put them in the browser, `localStorage`, …".

Citation convention: bracketed numbers such as [4] refer to the **Sources** list at the end. Every source was read on 2026-11-28. Where a primary source could not confirm a claim, the text says "**Unverified**". Sections marked **Synthesis** are my own reasoning from those sources. Source [6] is a set of `curl` probes I ran on 2026-11-28. It shows how GitHub's servers behaved that day, not a documented promise.

---

## 1. Can "Sign in with GitHub" finish in a browser-only page?

**Short answer: no.** All of GitHub's sign-in flows end at `https://github.com/login/oauth/access_token`, and that endpoint sends no CORS headers. A page can send the request, but the browser will not let its script read the response. The device flow needs no client secret, but it is blocked by CORS in the same way.

### 1.1 OAuth app web flow

- The token exchange needs the client secret. The parameter table for `POST https://github.com/login/oauth/access_token` lists `client_secret` as **Required**: "The client secret you received from GitHub for your OAuth app." [1]
- PKCE is supported but does not replace the secret. `code_challenge` and `code_challenge_method` are "Strongly recommended". The method "Must be `S256` - the `plain` code challenge method is not supported." `code_verifier` is "Required if `code_challenge` was sent during the user authorization." [1] The July 2025 changelog that announced PKCE says: "GitHub is not requiring PKCE for any authentication flow at this time, as GitHub does not distinguish between public and confidential clients." [4] Nothing in [1] or [4] says PKCE removes the need for `client_secret`.
- Empirical check [6]. A POST with a valid public `client_id`, a `code_verifier` and no `client_secret` returned `{"error":"incorrect_client_credentials","error_description":"The client_id and/or client_secret passed are incorrect."}`. That fits a secret being required even when PKCE is used. (The code was bogus, so this only shows that the credential check runs first.)
- CORS. The docs say: "CORS pre-flight requests (OPTIONS) are not supported at this time." [1] In [6], `OPTIONS` on `/login/oauth/access_token` with an `Origin` header returned `HTTP/2 404` and no `Access-Control-*` headers. A plain `POST` with `Origin: https://example.com` (status 200, JSON body) also had no `Access-Control-Allow-Origin` header. A browser therefore blocks the page from reading the token.
- The August 2026 changelog added expiring tokens with refresh for OAuth apps ("an access token that lives for eight hours and a refresh token that's valid for six months"), up to 10 redirect URIs, and wildcard redirect matching [5]. It says nothing about public clients, CORS or dropping the secret.

### 1.2 GitHub App web flow

- It is the same endpoint with the same rule. `client_secret` is required ("The client secret for your GitHub App"), and PKCE is strongly recommended with the same parameters [2]. The docs add: "If your app runs in the browser, you should use the web application flow to generate a user access token." [2] They do not explain how a page with no backend would keep the secret.
- User access tokens: "By default, the user access token expires after 8 hours." "The refresh token expires after 6 months." [2] "You can use the refresh token to generate a new user access token and a new refresh token. Once you use a refresh token, that refresh token and the old user access token will no longer work." [3] App owners can opt out of expiry, which "is not recommended due to the security implications" [12].
- A refresh needs the secret, unless the token came from the device flow: `client_secret` is "Required unless the user access token was generated using the device flow." [3]
- Reach: "The app can only access resources in an account where it is installed." Each org member also has to authorize the app [30]. So someone with install rights on the team's org has to install a Forecaster GitHub App there once.

### 1.3 Device flow (OAuth apps and GitHub Apps)

- It needs no secret: "The `client_secret` is not needed for the device flow." [1] `POST /login/device/code` takes only `client_id` and `scope` [1]. Refreshing a device-flow token needs no secret either [1][3].
- It must be turned on: "Before you can use the device flow … you must first enable it in your app's settings." [1][2]
- It does not use PKCE: "The device code flow and installation token flows do not use PKCE." [4]
- CORS, from [6]:
  - `POST https://github.com/login/device/code` with `Origin: https://example.com` and the public `client_id` of the GitHub CLI returned `HTTP/2 200` and `application/json`, with **no** `Access-Control-Allow-Origin`.
  - Polling `POST /login/oauth/access_token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code` also returned 200 JSON with no CORS headers.
  - `OPTIONS` on both endpoints returned 404.
  - The docs say nothing about CORS on the device endpoints. **Unverified** that this is a stable policy, but the observed behaviour blocks browser use.

### 1.4 The resource API does allow the browser

- "The REST API supports cross-origin resource sharing (CORS) for AJAX requests from any origin." [7]
- In [6], a preflight on `api.github.com/repos/octocat/Hello-World/issues` returned `204`, `access-control-allow-origin: *` and `access-control-allow-headers: Authorization, …`. A GET with `Origin: null`, which is what a `file://` page sends, returned `200` with `access-control-allow-origin: *`.

### 1.5 Synthesis

- Once the page has a token, it can read Issues straight from the browser, from GitHub Pages and from `file://` alike.
- The page cannot *obtain* a token through any GitHub sign-in flow on its own. Two things block it: the web flow needs a secret, and every token endpoint lacks CORS.
- The smallest piece of infrastructure that makes sign-in work is a **stateless CORS relay for the device flow**. It holds no secret: it forwards `device/code` and `access_token` requests and adds CORS headers. That is a few lines in a serverless function, but it is still a server the project runs, and the token passes through it.
- The full alternative is a backend that holds the client secret (see section 4).
- With device flow plus refresh, the EM signs in again only when the 6-month refresh token lapses, or when the stored tokens are lost [3]. The page still has to keep the refresh token, which section 4 counts as the most valuable thing to steal.

---

## 2. Can a URL open GitHub's fine-grained PAT form pre-filled?

**Yes, partly.** It has been supported since August 2025. You can set the name, description, owner, expiry and permissions. **You cannot pre-select repositories.**

- Changelog: "With the new query parameters on the fine-grained PAT creation page, you can now construct a shareable URL that captures the permissions, resources, lifetime, and details for a token." [9]
- Docs: "You can share templates for a fine-grained personal access token via links." "All parameters are optional and validated by the token generation form." [8] Example base URL: `https://github.com/settings/personal-access-tokens/new`.

| Parameter | Valid values [8] |
| --- | --- |
| `name` | ≤ 40 characters, URL-encoded |
| `description` | ≤ 1024 chars, URL-encoded |
| `target_name` | User or organization slug. "This is the owner of the repositories that the token will be able to access." Defaults to the current user. |
| `expires_in` | "Integer between 1 and 366, or `none`". Default 30 days, "or less if the target has a token lifetime policy set" |
| `<permission>` | e.g. `issues=read` (Issues accepts `read`, `write`). Metadata is `read` |

- Repositories: the table has no repository parameter [8], and the changelog does not mention picking repositories [9]. The EM still has to choose "Only select repositories" and pick the repo by hand (steps 11–12 in [8]). **Unverified** whether an undocumented parameter exists.
- If the EM isn't a member of `target_name`, the form shows "Cannot find the specified resource owner" [8].
- A Forecaster link would look like this: `https://github.com/settings/personal-access-tokens/new?name=Forecaster&description=Read+issues+for+the+Forecaster&target_name=<org>&expires_in=366&issues=read`.
- Classic PATs: `https://github.com/settings/tokens/new?scopes=…&description=…` pre-fills the scopes and the Note field. GitHub Docs do not document it (**Unverified** by GitHub). Third-party code relies on it: r-lib's `usethis` builds `"{host}/settings/tokens/new?scopes={scopes}&description={description}"` [31]. Classic tokens cannot be limited to one repo [8].

**Synthesis.** A template link cuts token-making to about four clicks: pick the repo, generate, copy, paste. It does not change the fact that the EM pastes a raw token, or that GitHub shows the value only once. That "shown once" behaviour is widely known, but the current docs page [8] does not state it, so it is **Unverified** from the docs.

---

## 3. Fine-grained PAT policies

- **Org approval is the default.** "Require administrator approval … This is the default value." [10] Until a token is approved, it "will be marked as `pending` … Your token will only be able to read public resources until it is approved. If you are an owner of the organization, your request is automatically approved." [8] Orgs can also block fine-grained PATs entirely [10].
- **Lifetime.** The form allows 1–366 days or `none` [8]. "Infinite lifetimes are allowed but may be blocked by a maximum lifetime policy set by your organization or enterprise owner." [8] "The default the maximum lifetime policy for organizations is set to expire within 366 days." [10] "The policies apply when tokens are created, regenerated, or used." [11] A token that breaks the policy is "blocked from accessing your organization", not revoked [10]. The no-expiry option was introduced "for personal projects" [11].
- **Regenerate.** The docs reviewed do not describe the Regenerate action. **Unverified** that it keeps the token's settings and issues a new value. [11] confirms only that lifetime policy applies at regeneration. Expired tokens cannot be restored: "you or the application will need to create a new token." [12]
- **Other revocation triggers.** Tokens are revoked after a year without use, and when pushed to a public repo or gist [12].
- **Works for the Issues REST API.** `GET /repos/{owner}/{repo}/issues` and `GET /repos/{owner}/{repo}/issues/{issue_number}` need Issues `read` and accept a PAT [13]. Cross-origin use is covered by 1.4.

**Synthesis.** For an org repo, a token made with `expires_in=366` lasts at most a year under the default policy. If the org owner sets a shorter policy, re-pasting is more frequent. Every new token may also wait for admin approval. So under default org settings, the realistic best case is one token per EM per year, provided it is stored persistently.

---

## 4. IETF: OAuth 2.0 for Browser-Based Applications (now RFC 10017, BCP 212)

The draft was published as **RFC 10017** (BCP 212, Best Current Practice) in August 2026 [14].

- **Three patterns, "presented in decreasing order of security"** [14 §6]:
  1. **Backend for Frontend (BFF).** The backend is a confidential client, holds the tokens, and proxies every API call. "This architecture is strongly recommended for business applications, sensitive applications, and applications that handle personal data." [14 §6.1.4.3]
  2. **Token-mediating backend.** The backend gets tokens and hands access tokens to the browser, which calls the API directly. "Only when the use cases or system requirements would prevent the use of a proxying BFF should the token-mediating backend be considered over a full BFF." [14 §6.2.4.4]
  3. **Browser-based OAuth client.** "This architecture is not recommended for business applications, sensitive applications, and applications that handle personal data." [14 §6.3.4.3]
- **Secrets in the browser.** A browser app "is unfit to contain provisioned secrets". Authorization servers "MUST NOT require client authentication of browser-based applications using a shared secret" [14 §6.3.3.1]. Token endpoints "MUST send necessary CORS headers" for browser clients [14 §6.3.3.4]. GitHub does neither (section 1).
- **Threat model.** Malicious JavaScript can "steal data from origin-based storage mechanisms (e.g., localStorage, IndexedDB)" [14 §5]. In "persistent token theft", attacker code keeps copying the latest tokens, which "already suffices to counter typical defenses against token theft, such as short lifetimes or refresh token rotation" [14 §5.1.2]. Even perfectly isolated storage "does not prevent the attacker from running a new flow to obtain a fresh set of tokens" [14 §6.3.4.2.1].
- **Storage.** localStorage "does not protect against unauthorized access from malicious JavaScript". sessionStorage "slightly reduces the exposure". IndexedDB is shared with Service Workers. "None of these options can fully mitigate token exfiltration when the attacker can execute malicious code in the application's execution environment." [14 §8.5] In-memory closures can be defeated by prototype poisoning [14 §8.4].
- **Encrypting tokens in the browser** [14 §8.6]:
  - "There is no guarantee that browser storage is encrypted at rest." Malware crawls browser profiles for tokens.
  - A non-extractable WebCrypto key "cannot be relied on as a way to protect against exfiltration from the underlying filesystem".
  - "The encryption keys would need to be stored somewhere other than the filesystem, such as on a remote server … out of scope of this document."
  - On DPoP-style non-exportable private keys: "no guarantee … that a non-exportable key is actually protected by a Trusted Platform Module (TPM) or stored in an encrypted form on disk" [14 §9.2]. GitHub does not issue sender-constrained (DPoP) tokens; **Unverified**, as no GitHub doc read mentions DPoP.
- **Origins.** "It is considered a best practice to avoid deploying more than one application in a single origin." [14 §9.4]
- **Reducing authority.** Use short lifetimes and narrow scopes [14 §9.1]. Here that means a one-repo, `issues:read` token.

## 5. OWASP

- HTML5 Security Cheat Sheet, current text: "Do not store authentication tokens, session IDs, JWTs, refresh tokens, or any credential in `localStorage` or `sessionStorage`. These APIs are accessible to any JavaScript executing in the origin, so a single XSS vulnerability discloses every token. Use `HttpOnly; Secure; SameSite=Strict` cookies (preferred) or a Backend-for-Frontend (BFF) pattern." [15] It also notes: "The standards do not require `localStorage` data to be encrypted-at-rest." [15]
- Password Storage Cheat Sheet, for passphrase-derived keys: "PBKDF2-HMAC-SHA256: 600,000 iterations (recommended)"; "PBKDF2-HMAC-SHA512: 220,000 iterations" [16].

## 6. In-browser encryption options

### 6.1 Non-extractable WebCrypto key in IndexedDB

- With `extractable: false`, `exportKey` throws `InvalidAccessError` [17]. CryptoKeys are serializable, and "most authors will make use of the Indexed Database API" to store them [17].
- The spec "places no normative requirements on implementations as to how the underlying cryptographic key material is stored. The only requirement is that key material is not exposed to script … it does not guarantee that the underlying cryptographic key material will not be persisted to disk, possibly unencrypted" [17].
- **Synthesis.**
  - It protects against someone who copies the stored ciphertext alone: a screenshot, a support dump, or devtools inspection of the stored value.
  - It does **not** protect against XSS. Attacker script in the origin can call `decrypt` with the same key.
  - It does not protect against malware that reads the profile, since key and ciphertext sit on the same disk [14 §8.6].
  - The EM never re-pastes, unless site data is cleared.

### 6.2 Passphrase-derived key (PBKDF2 via WebCrypto)

- WebCrypto supports PBKDF2 [17]. OWASP recommends 600,000 iterations for HMAC-SHA256 [16].
- **Synthesis.**
  - It protects at rest against profile theft and disk access, because the key is not stored.
  - It protects against XSS only while the page is locked. Once the EM unlocks, the token is in memory and reachable by script [14 §5].
  - The cost is typing a passphrase each visit, or each tab. That is not making a new token, but it is a second secret to remember. A forgotten passphrase means making a new PAT.

### 6.3 Passkey with the WebAuthn PRF extension

- **Spec.** WebAuthn Level 3 is a W3C Recommendation, dated 25 August 2026 [18]. PRF: "As a motivating example, PRF outputs could be used as symmetric keys to encrypt user data. Such encrypted data would be inaccessible without the ability to get assertions from the associated credential." [18 §10.1.4] It returns 32-byte outputs, is built on CTAP `hmac-secret`, and uses the PRF tied to user verification [18].
- **Origin rules.** "If callerOrigin is an opaque origin, throw a 'NotAllowedError' DOMException." The API is only exposed in secure contexts [18]. The RP ID must be the origin's domain or a registrable suffix of it [18]. `github.io` is on the Public Suffix List [24], so the RP ID on Pages would be `random11235.github.io`.
- **Browser support** (MDN browser-compat-data [19], release notes):

| Browser | `create()` PRF | `get()` PRF | Notes |
| --- | --- | --- | --- |
| Chrome / Edge (desktop and Android) | 116 | 116 | [19] |
| Firefox desktop | 139 | 139 | "the `prf` extension is supported on all desktop platforms" [20]. Firefox Android: `create` 149, `get` not supported [19] |
| Safari (macOS / iOS) | 18 | **not supported per [19]** | Apple: "Added support for the WebAuthn PRF extension." (Safari 18.0) [21]. WebKit bug 259934 "[WebAuthn] Implement PRF extension + hmac-secret" is RESOLVED FIXED [22]. The [19] `get()` entry conflicts with [21]; **Unverified** which is right for iCloud Keychain passkeys today |

- **Platform authenticators.**
  - iCloud Keychain and Google Password Manager: no first-party Apple or Google page read here states PRF support per authenticator. **Unverified.**
  - Windows Hello: vendor and community sources report `hmac-secret`/PRF support arriving with a February 2026 cumulative update (KB5077181) on 24H2/25H2 [32]. I found no Microsoft page confirming it. **Unverified.**
  - passkeys.dev's device-support matrix does not list PRF [33].
- **Synthesis.**
  - PRF gives at-rest protection like a passphrase, but unlocks with Touch ID, Face ID or Windows Hello: one tap per visit and no second secret.
  - It does not protect against XSS while unlocked, the same as 6.2.
  - It does **not** work on `file://` (opaque origin [25][26]).
  - Support gaps (Safari `get()`, Windows Hello, Firefox Android) mean the page needs a fallback. Losing the passkey means making a new PAT.

## 7. Origin isolation

- **GitHub Pages.** A user site is served at `http(s)://<owner>.github.io` and a project site at `http(s)://<owner>.github.io/<repositoryname>` [23]. Every project site of `random11235`, and its user site, therefore share the origin `https://random11235.github.io`. Any page on any of them can read the Forecaster's `localStorage` and IndexedDB. Different owners get different sites, because `github.io` is on the Public Suffix List [24]. A custom domain gives the app its own origin [23], which matches [14 §9.4].
- **`file://`.**
  - The URL Standard says of `file` origins: "Unfortunate as it is, this is left as an exercise to the reader. When in doubt, return a new opaque origin." [25] "Modern browsers usually treat the origin of files loaded using the `file:///` scheme as opaque origins." [26]
  - localStorage behaviour is undefined: "In all current browsers, `localStorage` seems to return a different object for each `file:` URL … there are no guarantees about that behavior … some browsers _have_ changed their handling for it over time." [27] So a stored token likely won't survive the EM moving or renaming the HTML file.
  - Secure Contexts: "the user agent SHOULD treat file URLs as potentially trustworthy", although its origin algorithm returns "Not Trustworthy" for opaque origins [28]. Whether `crypto.subtle` is available on `file://` in each browser is **Unverified**.
  - WebAuthn is not available on `file://` (opaque origin [18]).
- **CSP via `<meta>`.** "The Content-Security-Policy-Report-Only header is not supported inside a meta element. Neither are the report-uri, frame-ancestors, and sandbox directives." [29] `connect-src` is not on that list, so a meta CSP of `connect-src https://api.github.com` applies. Meta policies "are not applied to content which precedes them" [29], so the tag must come first in `<head>`. The GitHub Pages docs reviewed describe no way to set response headers, so meta is the only option there. **Synthesis:** `connect-src` limits where script can `fetch` to, but it is not a complete exfiltration barrier (for example, navigating the page away). It narrows XSS damage; it does not remove it.

---

## 8. Synthesis: options compared

"Paste or make a token" counts how often the EM has to create a PAT, assuming a 366-day fine-grained PAT under the default org policy (section 3).

| Option | How often the EM makes or pastes a token | Defends against | Infrastructure | Caveats |
| --- | --- | --- | --- | --- |
| Memory or sessionStorage only | Every visit or tab | Disk and profile theft; leaves nothing behind | None | Already rejected; with a once-shown PAT, means a new token each time |
| localStorage, plain, with mitigations (one-repo `issues:read` PAT, strict meta CSP, no third-party scripts, own origin) | About yearly (token expiry or approval) | Narrows the blast radius only. Not XSS [14 §8.5][15], not disk [14 §8.6] | None (a custom domain helps origin isolation) | Contradicts OWASP [15] and the repo's current rule; shared `random11235.github.io` origin [23]; `file://` storage is per-file and undefined [27] |
| Non-extractable AES key in IndexedDB, encrypted token | About yearly | Casual disclosure of the stored value only. Not XSS, not disk malware [14 §8.6][17] | None | Gives little beyond plain storage; same origin caveats |
| Passphrase-derived key (PBKDF2, 600k) | About yearly, plus a passphrase each visit | Disk and profile theft; XSS only while locked | None | Second secret; a forgotten passphrase means a new PAT |
| Passkey PRF-derived key | About yearly, plus a biometric tap each visit | Disk and profile theft; XSS only while locked | None (needs a stable https origin) | Not on `file://`; Safari `get()` and Windows Hello support **Unverified**; needs a fallback |
| Device flow through a stateless CORS relay (no secret), GitHub App user token + refresh in browser | No PAT. Sign-in about every 6 months (refresh token life) [3] | Short-lived (8 h) access tokens [2]; nothing to paste. Refresh token in browser is still exposed to XSS [14 §5.1.2] | A tiny serverless relay; register a GitHub App with device flow on; an org owner installs it [30] | Browser-based OAuth client pattern, "not recommended for business applications" [14 §6.3.4.3]; tokens pass through the relay |
| Backend with GitHub App web-flow sign-in (BFF or token-mediating, e.g. a serverless function or Cloudflare Worker holding the secret) | No PAT. Sign-in when the session or refresh token lapses (≤ 6 months [3]) | BFF: tokens never reach the browser; XSS can only act through the live session [14 §6.1.4.3] | A hosted backend with secret storage and session cookies; the GitHub App installed on the org [30] | Highest effort; a cookie session from `file://` (opaque origin) is **Unverified** to work; ends "no server" |

**What is "typical" according to the sources.** For business apps, both the IETF BCP [14] and OWASP [15] point to a backend: a BFF first, a token-mediating backend second. A browser-only client that holds tokens is a recognised pattern, but [14] explicitly does not recommend it for business apps. Neither source endorses localStorage for credentials. [14] treats in-browser encryption as protection at rest only, and says real protection needs the key "somewhere other than the filesystem, such as on a remote server". The sources do not say how common "paste a PAT into a static page" tools are, and I found no primary source measuring it.

**Is "encryption infrastructure" needed?** No server is needed for WebCrypto, PBKDF2 or PRF. They are browser APIs. None of them stops XSS while the token is in use [14 §5][14 §8.6]. Their only gain is at rest. That gain is real only when the key is not stored beside the data: a passphrase or a passkey, not a non-extractable key in IndexedDB.

**Verified vs unverified.**

- Verified from primary sources or direct probes:
  - The web flow needs `client_secret`, even with PKCE [1][2][4][6].
  - The device flow needs no secret [1][3].
  - The `github.com/login/*` token endpoints send no CORS headers, and `api.github.com` sends `*` [1][6][7].
  - Fine-grained PAT template URLs exist for name, description, owner, expiry and permissions, but not repositories [8][9].
  - Org approval and the 366-day policy are the defaults [10][11].
  - GitHub App token lifetimes are 8 h and 6 months [2][3].
  - RFC 10017's rankings and storage guidance [14]; OWASP's localStorage rule [15].
  - The GitHub Pages shared origin [23][24]; `file://` origin and localStorage behaviour [25][26][27]; meta CSP limits [29].
- **Unverified:**
  - Regenerate keeping a PAT's settings.
  - "Token shown once" as stated in current docs.
  - Classic PAT pre-fill (not in GitHub Docs).
  - A hidden repository parameter in the template URL.
  - Device-endpoint CORS as stable policy rather than observed behaviour.
  - Safari `get()` PRF status, Windows Hello PRF, and per-authenticator PRF for iCloud Keychain and Google Password Manager.
  - `crypto.subtle` on `file://` per browser.
  - Cookie sessions from `file://`.

---

## Sources

All accessed 2026-11-28.

1. GitHub Docs, "Authorizing OAuth apps". https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
2. GitHub Docs, "Generating a user access token for a GitHub App". https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
3. GitHub Docs, "Refreshing user access tokens". https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens
4. GitHub Changelog, "PKCE support for OAuth and GitHub App authentication", 2025-07-14. https://github.blog/changelog/2025-07-14-pkce-support-for-oauth-and-github-app-authentication/
5. GitHub Changelog, "Multiple redirect URIs and token refresh for OAuth apps", 2026-08-14. https://github.blog/changelog/2026-08-14-multiple-redirect-uris-and-token-refresh-for-oauth-apps
6. Direct `curl` probes, 2026-11-28 (edge region australiaeast): `OPTIONS` and `POST` with `Origin: https://example.com` to `https://github.com/login/oauth/access_token` and `https://github.com/login/device/code` (bogus and real public client IDs; no credentials), and `OPTIONS`/`GET` with `Origin: https://example.com` and `Origin: null` to `https://api.github.com/repos/octocat/Hello-World/issues`.
7. GitHub Docs, "Using CORS and JSONP to make cross-origin requests". https://docs.github.com/en/rest/using-the-rest-api/using-cors-and-jsonp-to-make-cross-origin-requests
8. GitHub Docs, "Managing your personal access tokens". https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
9. GitHub Changelog, "Template URLs for fine-grained PATs and updated permissions UI", 2025-08-26. https://github.blog/changelog/2025-08-26-template-urls-for-fine-grained-pats-and-updated-permissions-ui
10. GitHub Docs, "Setting a personal access token policy for your organization". https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
11. GitHub Changelog, "New PAT rotation policies preview and optional expiration for fine-grained PATs", 2024-10-18. https://github.blog/changelog/2024-10-18-new-pat-rotation-policies-preview-and-optional-expiration-for-fine-grained-pats/
12. GitHub Docs, "Token expiration and revocation". https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation
13. GitHub Docs, "Permissions required for fine-grained personal access tokens". https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
14. Parecki, De Ryck, Waite, RFC 10017 / BCP 212, "OAuth 2.0 for Browser-Based Applications", August 2026 (formerly draft-ietf-oauth-browser-based-apps-27). https://www.rfc-editor.org/rfc/rfc10017.txt
15. OWASP Cheat Sheet Series, "HTML5 Security Cheat Sheet". https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/HTML5_Security_Cheat_Sheet.md
16. OWASP Cheat Sheet Series, "Password Storage Cheat Sheet". https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Password_Storage_Cheat_Sheet.md
17. W3C, "Web Cryptography API" (editor's draft). https://w3c.github.io/webcrypto/
18. W3C, "Web Authentication: An API for accessing Public Key Credentials, Level 3", Recommendation, 25 August 2026, §10.1.4 and §5.1.3/§5.1.4. https://www.w3.org/TR/webauthn-3/
19. MDN browser-compat-data, `api/CredentialsContainer.json` (`create`/`get` `publicKey_option.extensions.prf`). https://github.com/mdn/browser-compat-data/blob/main/api/CredentialsContainer.json
20. MDN, "Firefox 139 release notes for developers". https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/139
21. Apple Developer, "Safari 18 Release Notes". https://developer.apple.com/documentation/safari-release-notes/safari-18-release-notes
22. WebKit Bugzilla, bug 259934, "[WebAuthn] Implement PRF extension + hmac-secret". https://bugs.webkit.org/show_bug.cgi?id=259934
23. GitHub Docs, "What is GitHub Pages?". https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
24. Public Suffix List (`github.io` entry). https://publicsuffix.org/list/public_suffix_list.dat
25. WHATWG, URL Standard, "Origin". https://url.spec.whatwg.org/#origin
26. MDN, "Same-origin policy", "File origins". https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy
27. MDN, "Window: localStorage property". https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
28. W3C, "Secure Contexts", §3.1–3.2. https://w3c.github.io/webappsec-secure-contexts/
29. W3C, "Content Security Policy Level 3" (editor's draft), meta delivery and `frame-ancestors`. https://w3c.github.io/webappsec-csp/
30. GitHub Docs, "Authenticating with a GitHub App on behalf of a user". https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/authenticating-with-a-github-app-on-behalf-of-a-user
31. r-lib/usethis source, `R/github_token.R` (`create_github_token()`). https://github.com/r-lib/usethis/blob/main/R/github_token.R
32. Corbado, "Passkeys & WebAuthn PRF" (vendor blog, secondary; cited only for the Windows Hello claim, which stays **Unverified**). https://www.corbado.com/blog/passkeys-prf-webauthn
33. passkeys.dev, "Device support". https://passkeys.dev/device-support/
