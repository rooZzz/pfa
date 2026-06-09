# Remote hosting and authentication plan

## Purpose

Take the app from a localhost-only MCP server to a single-user, internet-reachable service that any MCP client can log into with a passkey, hosted on an always-on Mac mini and exposed through ngrok. The app keeps its current shape: Node, better-sqlite3 plus DuckDB over one on-disk SQLite file, native modules, data and secrets never leaving the machine. No cloud compute, no data-layer rewrite.

This document is the umbrella design. Each phase below is scoped to ship and unlock value on its own, so it can be lifted into a standalone targeted plan. Phases are ordered by dependency, but the value each delivers does not depend on the phases after it.

> Implementation status: the host/ops layer (Phases 0, 5, 6, 7) is provisioned and verified on the Mac mini; see [mac-mini-runbook.md](mac-mini-runbook.md) for the live status and exact commands. One deliberate divergence from the text below: because FileVault is enabled (and disables auto-login), the services run as LaunchDaemons in the system domain rather than per-user LaunchAgents, and the deploy restarts the server via a single narrow `sudoers` entry instead of in-session `launchctl`. Remote access has been proven end to end from a second machine over an ngrok tunnel, using a temporary Basic-Auth gate at the ngrok edge (the in-band auth layer is not built yet) and the `--host-header` workaround for the DNS-rebinding guard (see Phase 5 learning). The next stage is a thin vertical slice of the full passkey auth flow (see "Next stage" below); Phases 1-4 are otherwise not yet started.

## End-state architecture

One process on the Mac mini plays three roles:

1. MCP server (today, unchanged): tools and `ui://` resources over Streamable HTTP.
2. OAuth 2.1 Resource Server (new): publishes Protected Resource Metadata, validates the bearer token on `/mcp`, enforces the single-user identity.
3. OAuth 2.1 Authorization Server (new): the `mcpAuthRouter` endpoint surface plus a custom `OAuthServerProvider`, with passkey login rendered in the Instrument design language.

Because the Authorization Server and Resource Server are the same process, the server signs tokens with a private key and verifies them in process with the matching public key. The JWKS endpoint exists so a future separate client or resource server can verify independently.

ngrok provides a stable public HTTPS URL (reserved domain) and TLS. With OAuth enforced in band, ngrok is ingress only and does not gate auth. The server binds two loopback listeners (see Continuity below): an open port for local clients and an authenticated port that ngrok forwards to. Nothing is reachable from the public internet except through the tunnel, and the tunnel only ever reaches the authenticated port.

### Continuity: current usage never breaks

The localhost bind is already the trust boundary, so the gate is applied to the public path only, not universally. The server runs two loopback listeners in one process sharing the same `buildServer()` and database:

- An open port (today's `127.0.0.1:4000`), no auth, for a Claude Desktop running on the Mac mini. Unchanged across every phase.
- An authenticated port (for example `127.0.0.1:4001`), token required, which is the only port ngrok forwards to.

The public internet cannot reach the open port: it is loopback-only and ngrok is not pointed at it, so leaving it open is no weaker than today. This means there is no window where the app is unusable. A co-located Claude Desktop keeps working untouched throughout. A remote Claude Desktop reaches the authenticated port through ngrok and, from Phase 1 onward, connects with a minted static token via `mcp-remote --header` until the interactive passkey login lands in Phase 3. The only thing Phase 3 adds is the login experience, not access.

### Why this shape

- Preserves local-first: the SQLite store, ingested documents, and live Monzo tokens stay on hardware the user controls.
- No native-module porting, no Docker, no managed database.
- Standards-based auth, so non-Claude MCP clients work without bespoke wiring.
- Passwordless: a discoverable passkey with user verification is possession plus biometric, unphishable, and stronger than a password on a public finance endpoint.

### Request flow at end state

1. Client requests `/mcp` without a token.
2. Server returns `401` with `WWW-Authenticate: Bearer ... resource_metadata="https://DOMAIN/.well-known/oauth-protected-resource"`.
3. Client reads Protected Resource Metadata, learns the authorization server is this same origin and the resource identifier is the MCP URL.
4. Client reads `…/.well-known/oauth-authorization-server`, discovers the authorize, token, and registration endpoints.
5. Client self-registers via Dynamic Client Registration.
6. Client runs OAuth 2.1 auth-code with PKCE: the browser opens the authorize page, the user verifies a passkey, the server returns a single-use code.
7. Client exchanges the code at the token endpoint for a signed JWT scoped to the MCP resource, plus a refresh token.
8. Client calls `/mcp` with `Authorization: Bearer <JWT>`. The server verifies and serves.

## Decisions to lock before starting

These bind several phases and are cheap to get wrong if deferred.

- Public domain and Relying Party ID. The WebAuthn RP ID must equal the final public domain, and a passkey enrolled against one RP ID does not work on another. Choose the reserved ngrok domain (or a custom domain fronted by ngrok) before any passkey enrollment in Phase 3. Local enrollment on `localhost` would mint a credential unusable on the public domain.
- Single-user identity claim. Pick the constant `sub` value the server treats as the one authorized principal. Stored in config, asserted at the Resource Server.
- Token lifetimes. Short access token (suggest 10 to 60 minutes), longer rotating refresh token (suggest 30 to 90 days). Confirm before the token endpoint lands.
- Signing key location. Ed25519 keypair, private key in a `0600` file outside the repo (not the login Keychain: a system LaunchDaemon has no Keychain session), never in the database or git. Public key published via JWKS with a stable `kid`.
- Resource indicator. The MCP endpoint URL, enforced so tokens carry a matching `aud`.
- Secrets boundary. All runtime secrets stay on the mini, provisioned once: the OAuth signing key generated into a `0600` key file, the third-party API keys in `.env`. They are never stored in GitHub or injected through the CI/CD path, because the deploy does not need them and the signing key must not leave the box.
- App restart privilege. The app runs as a system LaunchDaemon (FileVault disables auto-login, so per-user LaunchAgents are not viable), and the deploy restarts it through one narrow sudoers entry scoped to `launchctl kickstart -k system/com.pfa.server`.

## Environment and config additions

Read from `server/.env` (and the `0600` signing-key file), validated at startup, fail loud:

- `PUBLIC_ORIGIN` (for example `https://pfa.example.com`), also the OAuth issuer.
- `RP_ID` and `RP_NAME` for WebAuthn.
- `MCP_RESOURCE` (the `/mcp` URL), used as the audience and resource indicator.
- `AUTHORIZED_SUBJECT`, the single-user identity.
- Access and refresh token TTLs.
- Signing key reference (path to the `0600` key file).

ngrok configuration (authtoken, reserved domain, traffic policy) lives in the ngrok config file, not the app.

## Next stage: thin-slice passkey auth (vertical cut, no design system)

> Status: implemented. Code in `server/auth/` (config, keys, tokens, clients_store, provider,
> webauthn, pages, routes, app), migration `0012_oauth_and_webauthn`, CLIs `gen-signing-key` /
> `enroll-passkey` / `mint-token`, and the 4001 listener in `http.ts`. Express on the auth port;
> the open 4000 path is unchanged. Bring-up and the laptop connector are in
> [mac-mini-runbook.md](mac-mini-runbook.md) (Authentication).

Before fleshing out Phases 1-4 individually, build one minimal vertical slice that exercises the entire intended passkey OAuth path end to end against the live mini and ngrok. The point is to prove the architecture - discovery, registration, the real WebAuthn ceremony, the real token shape, the gated endpoint - in one cut, deferring only presentation polish and the broader hardening. The per-phase sections below remain the reference for hardening each part afterward.

In scope (kept thin):
- Resource Server gate on the authenticated port (`4001`): verify the signed JWT (`iss`, `aud = MCP_RESOURCE`, `exp`, `sub = AUTHORIZED_SUBJECT`); `401` plus `WWW-Authenticate`; Protected Resource Metadata; `/health`. Add `PUBLIC_ORIGIN`'s host to `ALLOWED_HOSTS`/`ALLOWED_ORIGINS` - this is the real fix that retires the `--host-header` stopgap.
- Authorization Server: `mcpAuthRouter` plus a custom `OAuthServerProvider` - AS metadata, Dynamic Client Registration, `authorize` (PKCE S256), `token` with refresh rotation, JWKS. Ed25519 signing key in a `0600` file (a LaunchDaemon has no Keychain session).
- Passkey via `@simplewebauthn/server`: one-time local enrollment (a CLI-minted single-use link opened at the public origin so the credential binds to the ngrok RP ID), then assertion on the authorize page; discoverable credential, `userVerification: required`; a `webauthn_credential` migration. Auto-approve consent for the single user.
- Browser pages as plain server-rendered HTML (login, error, interstitial) - no Instrument tokens, fonts, or React; functional markup only.

Explicitly deferred to the fuller phases:
- Instrument design-language styling of the auth pages (Phase 3 polish).
- The dedicated end-to-end integration suite (Phase 4), beyond unit tests for the slice.
- Rate-limiting, the auth audit log, and recovery-passkey niceties (minimal or stubbed for the slice).

Done when, from the laptop, a fresh MCP client (MCP Inspector or the Claude Code CLI) discovers the server, self-registers, completes the passkey ceremony at the ngrok domain, exchanges a code for a token, and calls `/mcp` successfully - while an unauthenticated call still gets `401`. This is the proof that the auth design holds before investing in styling and breadth.

## Phase 0: Data migration and cutover

Move the existing rich, real data from the current machine to the Mac mini, so every later phase is built and tested against true data. This is a one-time manual procedure; Phase 6 later generalizes the same backup-and-restore primitive for disaster recovery.

Scope:
- Move the full `PFA_DIR` (default `~/.pfa`): the `data.sqlite` file and the `documents/` directory (ingested PDFs and screenshots the database references for audit). Copy `server/.env` (Anthropic and Etherscan keys) separately. Monzo OAuth tokens travel inside the database (`connector_state`) and need no special handling.
- Consistency: stop the source server before copying so the single-writer SQLite file is quiescent and the copy is consistent. If WAL is enabled, checkpoint first or copy the `-wal` and `-shm` files alongside. The SQLite online backup (`.backup`) is the live-snapshot alternative if stopping is undesirable; for a one-time move, stopping is simplest and bulletproof.
- Transport: rsync over SSH on the LAN, preferred for the `documents/` tree (resumable, preserves the structure). Enable Remote Login on the mini, use key-based auth, address it as `mac-mini.local`. AirDrop or a USB drive are equivalent Mac-to-Mac options that need no SSH.
- On arrival: set `PFA_DIR` on the mini, start the app on the open local port, and let the schema migrations bring the file current (idempotent via the migration-tracking table). Verify with `PRAGMA integrity_check`, and compare a few row counts and a `get_net_worth` read against the source.
- Single-writer invariant: after cutover the mini is the sole writer. Stop running the server on the old machine and keep it as a cold backup only. Never run two writers against copies of the store.
- Provision secrets once on the mini at this point: the signing key is generated locally into a `0600` file (Phase 1), and the `.env` API keys are placed once. Secrets never enter the CI/CD path (see Phase 7).

Validation: `PRAGMA integrity_check` passes; spot-checked figures match the source; the app serves reads on the mini.

Value unlocked: the mini holds your real data from the start, so the auth, test, and deploy phases are exercised against a true store rather than an empty one.

## Phase 1: Resource Server gate

Close the door. Make `/mcp` require a valid signed bearer token, with the single-user check, before any login UI exists. The endpoint becomes safe to expose immediately, and the rest of the work can be tested against a real gate.

Scope:
- Split into two loopback listeners in `http.ts` sharing one `buildServer()` and database: the existing open port for local clients, and a new authenticated port that ngrok will forward to. The token gate is applied to the authenticated port only, so current local usage is untouched (see Continuity in the architecture section).
- Add a Resource Server module with token verification middleware applied to `/mcp` on the authenticated port: verify signature against the app public key, check `iss`, `aud` equals `MCP_RESOURCE`, `exp`, and `sub` equals `AUTHORIZED_SUBJECT`. Reject everything else.
- Serve `GET /.well-known/oauth-protected-resource` returning `resource`, `authorization_servers` (this origin), and `bearer_methods_supported: ["header"]` on the public path.
- Return `401` plus the `WWW-Authenticate` challenge on missing or invalid tokens.
- Add `GET /health` (unauthenticated, returns ok) for ngrok and monitoring.
- Generate and store the Ed25519 signing keypair; add the key accessor (fail loud if absent).
- Add a local CLI (`npm run mint-token`, mirroring the `monzo:auth` helper) that prints a short-lived signed token for testing and break-glass. Prints only, never writes the database.
- Extend the Host and Origin allowlist for the authenticated port to accept `PUBLIC_ORIGIN`. Keep both listeners bound to `127.0.0.1`. Allow requests with no Origin (non-browser clients) while constraining browser Origins to the known set.
- Use a small, audited JWT library (for example `jose`) for signing and verification. Do not hand-roll token crypto.

Files: new `server/auth/` module, edits to `http.ts`, a new `server/mint-token.ts`, a `package.json` script.

Validation: unit tests for verification (valid, expired, wrong audience, wrong subject, bad signature, missing token). `npm run verify` green. Manually reach `/mcp` through `mcp-remote --header "Authorization: Bearer <minted>"` and confirm tools work; confirm an unauthenticated request gets `401` with the challenge.

Value unlocked: a cryptographically gated remote endpoint. Combined with Phases 5 and 6 this is already a usable remote setup over a static minted token, which doubles as the permanent break-glass fallback if the interactive connector flow ever breaks.

## Phase 2: Authorization Server

Stand up the OAuth machinery so a client can discover, register, authorize, and exchange a code for the same token shape Phase 1 already verifies. Login is a temporary stub here (a button that authenticates the single user without a passkey), replaced in Phase 3.

Scope:
- Mount `mcpAuthRouter` from the MCP SDK with a custom `OAuthServerProvider`, configured with `issuerUrl = PUBLIC_ORIGIN`, the base URL, and supported scopes. This installs the authorization server metadata, Dynamic Client Registration, token, and revocation endpoints.
- Implement the provider:
  - `authorize`: validate the client, `redirect_uri` (exact match), PKCE `code_challenge` (S256 required, reject plain), and the resource indicator. Render the login page, authenticate the single user (stub), mint a single-use auth code bound to the client and the code challenge, redirect back.
  - token exchange: verify the PKCE `code_verifier`, single-use and short-TTL code, then issue the signed JWT (same shape as Phase 1) and a refresh token. Support the refresh-token grant with rotation.
  - revocation.
- Publish JWKS at the SDK metadata location with the public key and `kid`.
- Lock Dynamic Client Registration: accept registrations but make login the wall, and keep the single-user assertion at the Resource Server as the hard backstop. Optionally restrict registration to a first-run window or known redirect URIs.
- Migrations (next numbers from 0012): `oauth_client` (client id, name, redirect URIs, auth method, created, disabled), `oauth_authorization_code` (code hash, client, redirect URI, code challenge and method, resource, scope, subject, expiry, used marker), `oauth_refresh_token` (token hash, client, subject, scope, resource, expiry, rotated-to, revoked marker). Store hashes, not raw secrets.

Files: extend `server/auth/`, wire the router into `http.ts` (route OAuth paths to the router, `/mcp` to the existing handler), new migrations.

Validation: provider unit tests (PKCE pass and fail, code single-use, expiry, redirect-uri mismatch, resource enforcement, refresh rotation). Drive the full flow with MCP Inspector against the stub login. `npm run verify` green.

Value unlocked: a working OAuth 2.1 flow end to end. An MCP client can connect with no pre-shared secret. Everything except the final credential is real.

## Phase 3: Passkey authentication and Instrument login UI

Replace the stub with passwordless WebAuthn and render every browser-facing page in the Instrument design language.

Scope:
- WebAuthn with a library (for example `@simplewebauthn/server`):
  - Registration as a discoverable credential with `residentKey: "required"` and `userVerification: "required"`.
  - Authentication endpoints used by the authorize page: generate assertion options, verify the assertion, then continue the authorize flow to issue the code.
  - Migration `webauthn_credential` (credential id, public key, sign count, transports, label, created, last used). Support multiple credentials for device redundancy.
- Enrollment bootstrap (local, one-time, passwordless): a local CLI that mints a single-use enrollment link printed to the Mac mini console, mirroring the `monzo:auth` pattern. Opening it once at the public origin runs the registration ceremony, then the enrollment route disables itself. Machine and console access is the bootstrap root of trust. The ceremony must run at the public origin so the credential binds to the production RP ID.
- Recovery without a password: enroll multiple passkeys up front (laptop, phone, a hardware key kept offline); recovery is re-running the local enrollment ceremony, since the user holds the server. No password fallback.
- Browser pages, all Instrument-compliant: login (one verify button), error, and a brief signed-in interstitial. These are server-rendered HTML hit by a real browser, not `ui://` iframe resources, so the iframe runtime does not apply. Reuse the token layer instead.
- Design system reuse: serve the existing token CSS from `server/src/styles/` and the self-hosted woff2 fonts from `server/src/fonts/` on the auth routes, so the pages inherit the exact oklch colors, type scale, spacing, motion, and `prefers-color-scheme` dark and light. Hand-write the small page templates with the existing classes; React is not needed for a credential form. This makes the design system a second consumer of the token layer (server-rendered pages alongside the iframe surfaces), honoring the single-source token rule in the project standards. Confirm the token CSS is cleanly separable from the React primitives in `components.tsx`; it already is.
- Consent: auto-approve after login for the single user's own clients. No consent screen.

Files: extend `server/auth/` (WebAuthn provider, page templates, static CSS and font serving), new `server/enroll-passkey.ts`, a migration, a `package.json` script.

Validation: passkey registration and assertion unit tests using a virtual authenticator. Visual check of login, error, and interstitial in light and dark against the design language. Full interactive flow through MCP Inspector with a real passkey. `npm run verify` green.

Value unlocked: the real, passwordless, design-compliant login. This is the headline capability: log in from anywhere with a passkey, nothing secret in any client config.

## Phase 4: Integration test suite

A dedicated end-to-end suite that exercises the whole authenticated HTTP surface and proves the existing tools still behave correctly now that they sit behind auth. Distinct from the per-phase unit tests, which ship with each phase per the project test discipline.

Scope:
- A new vitest project (mirror `vitest.live.config.ts`: a `tests/integration/**` include with its own config and setup) that boots an ephemeral server instance on a random port with a temporary `PFA_DIR` and a test signing key.
- Auth-path coverage:
  - Unauthenticated `/mcp` returns `401` with a correct `WWW-Authenticate` challenge.
  - Protected Resource Metadata and authorization server metadata documents are well-formed and consistent.
  - Dynamic Client Registration succeeds and returns a usable client.
  - Authorize plus PKCE plus a programmatic passkey (WebAuthn virtual authenticator test seam) yields a code; the code exchanges for a valid token.
  - Token verification rejects expired, wrong-audience, wrong-issuer, tampered, and wrong-subject tokens.
  - Refresh rotates and invalidates the prior refresh token; revocation works.
  - Single-user enforcement: a token for any other subject is refused at `/mcp`.
- Tools-behind-auth coverage: with a valid token, call a representative set across the surface (a read tool, a manual-entry write, a correction, `get_briefing`, `evaluate_scenario`, a connector sync stub) and assert results match the pre-auth behavior. Confirm no tool path requires changes beyond the gate.
- A `package.json` script (`test:integration`) and inclusion in a documented full-gate run. Keep deterministic: no sleeps, fixed clock for token expiry assertions, seeded data.

Files: `server/tests/integration/`, an integration vitest config, a `package.json` script.

Validation: the suite runs green locally and in CI; intentionally breaking the gate (skip subject check) turns it red.

Value unlocked: confidence that the gate is correct and that fronting the existing tools with auth changed none of their behavior. This is the safety net for everything else.

## Phase 5: ngrok ingress

Give the gated server a stable public HTTPS identity.

Scope:
- Reserve the domain chosen in the decisions section (ngrok reserved domain, or a custom domain attached to ngrok with TLS).
- ngrok configuration file: tunnel to `127.0.0.1:PORT`, the reserved domain, and a minimal traffic policy. Auth is in band, so the policy is a safety layer only: optionally an IP allowlist if client IPs are stable, and forwarding of the health route.
- Do not block Anthropic's connector broker. The claude.ai connector uses a server-side broker that calls the MCP endpoint; ensure its IP range (`160.79.104.0/21`) is not denied by any policy or upstream filtering, since this was a documented cause of connector failures.
- Confirm the public origin and RP ID match exactly what Phase 3 enrolled against. A domain change invalidates existing passkeys and requires re-enrollment.
- Verify TLS, the metadata documents, and the `401` challenge are all correct through the public URL.
- DNS-rebinding guard (learned in the pre-auth proof): `server/http.ts` rejects any request whose `Host` is not in `ALLOWED_HOSTS` (`127.0.0.1:PORT`, `localhost:PORT`), returning `403`. ngrok forwards its own domain as the `Host`, so it is refused. The throwaway proof worked around this with the agent flag `--host-header=localhost:4000` (rewrites the upstream `Host`), but the real fix on the authenticated port is to add `PUBLIC_ORIGIN`'s host to `ALLOWED_HOSTS`/`ALLOWED_ORIGINS` (already in Phase 1 scope). Do not ship the host-header rewrite as the permanent answer.

Files: an ngrok config file in the repo or a documented location, a short runbook section.

Validation: from a different network, the public URL serves metadata and returns `401` on `/mcp`; the full passkey flow completes through the public domain in MCP Inspector and Claude Code CLI before testing claude.ai or Claude Desktop.

Value unlocked: reachable from anywhere over a stable HTTPS URL, ready for a real client to connect.

## Phase 6: Durable Mac mini daemon

Make the host stay up and self-heal without manual intervention. Delivered as a separate operations runbook.

Scope:
- launchd units (LaunchDaemons or LaunchAgents) for two services: the MCP server (`npm start` or the built entry) and the ngrok agent. Both with `KeepAlive` so a crash or reboot restarts them, `RunAtLoad`, working directory, environment, and `StandardOut`/`StandardError` to log files.
- Prevent sleep: `pmset` configuration (`sleep 0`, `disablesleep` as appropriate), and confirm behavior on power loss and restart (auto power-on after outage in firmware or energy settings).
- Time sync: ensure NTP is enabled, since token expiry depends on a correct clock.
- Log management: log file locations and rotation (`newsyslog` or a size cap) so logs do not grow unbounded.
- Crash and downtime notification: a lightweight check (a launchd watcher or an external uptime ping against `/health`) that alerts the user if the service is down.
- Kill switch: a documented one-command way to stop the public tunnel quickly (unload the ngrok launchd unit) without touching the data.
- Startup ordering and recovery: verify the full stack comes back cleanly after a hard reboot, including DuckDB reattaching the SQLite file.

Files: `launchd` plist files, a runbook in `docs/` (or a section here) with the exact commands.

Validation: kill each process and confirm it restarts; reboot the Mac mini and confirm the public URL is live without manual steps; pull the power and confirm recovery.

Value unlocked: an unattended, self-healing always-on service.

## Phase 7: Build and deploy pipeline

Hands-off, observable, release-driven deploys to the mini, with automatic backup and rollback. Depends on Phase 6 (the daemon must exist to be restarted).

Scope:
- A self-hosted GitHub Actions runner on the mini, registered to the private repo, configured ephemeral (just-in-time: at most one job, then auto-deregistered). It runs as a dedicated low-privilege macOS user and holds only an outbound connection to GitHub, opening no inbound port.
- A deploy workflow triggered on `release: published`, plus `workflow_dispatch` for manual reruns. No `pull_request` trigger feeds the runner. Correctness CI (`npm run verify`) stays on GitHub-hosted runners per PR, unchanged.
- Deploy job on the mini, against the released tag: back up the SQLite store and `documents/` (the Phase 6 backup primitive), checkout the tag, `npm ci` (rebuilds the native modules for arm64), `npm run build:ui`, run schema migrations, restart the app service, health-check `/health`. On any failure, roll back to the previous tag and restore the backup, then surface the failure.
- App restart boundary: the app runs as a system LaunchDaemon and the deploy restarts it through a single narrow sudoers entry for the exact `launchctl kickstart -k system/com.pfa.server` command (FileVault rules out a per-user LaunchAgent).
- Secrets are not injected by the pipeline and the deploy needs none of them: build, migrate, and restart never read the signing key or API keys, which the running daemon reads at runtime from the `0600` key file and `.env` (provisioned once in Phase 0). The runner authenticates to GitHub with its own just-in-time registration token, not a stored long-lived secret.
- Observability: the runner streams job logs to the GitHub Actions UI (the native observability that motivates choosing a runner over polling), and deploy failures also fire the Phase 6 alert channel, so each release has a visible deploy record and history.
- Hardening: ephemeral runner, dedicated user, restricted triggers, keep the runner host patched (it auto-updates), and persist no secrets on the runner. Runner groups are an org-level feature and do not apply to a personal repo.

Validation: publishing a test release triggers a deploy that backs up, builds, migrates, restarts, and health-checks; a forced failure rolls back cleanly and alerts; the Actions UI shows the run and its logs.

Value unlocked: deliberate, versioned, observable deploys with no manual steps and no manual secret handling, plus automatic backup and rollback on every release.

## Cross-cutting: hardening, operations, and the items easy to miss

These are not a single phase. Fold each into the phase noted, and treat this as the checklist of things beyond the four headline items.

- Brute-force and abuse protection (Phase 2 and 3): rate-limit the authorize, token, and WebAuthn endpoints. Even single-user, the endpoints are public.
- Auth audit log (Phase 1 to 3): record auth events (login success and failure, token issuance, refresh, revocation, registration) to an append-only log or table for after-the-fact review. Do not log tokens or secrets.
- CORS and security headers (Phase 3): the browser-facing auth pages need correct CORS and standard headers (HSTS, frame-ancestors, no-store on auth responses). The JSON-RPC `/mcp` path does not need CORS for non-browser clients.
- Secret and key hygiene (Phase 1): signing key in a `0600` file outside git (not the login Keychain, which a system LaunchDaemon cannot reach); rotateable via the JWKS `kid`. WorkOS-style third-party secrets are not used in this design. Secrets stay on the mini and never enter GitHub or the CI/CD path (Phase 7); the deploy does not need them.
- Backups (Phase 6): the data is now both more valuable and reachable. Keep Time Machine plus a periodic SQLite backup (the `.backup` command or a copy while the writer is quiesced) to a second location. Confirm a restore.
- Claude connector reliability is an external dependency (Phase 5): the claude.ai and Claude Desktop OAuth connector flow has shown breakage in 2026 independent of the server and authorization server. Mitigations: validate with MCP Inspector and Claude Code CLI first, keep the reserved domain stable, allow the broker IP range, and keep the Phase 1 static-token path documented as the break-glass fallback (`mcp-remote --header`).
- Tool-list changes still need a Claude restart: unrelated to auth, but note that adding or renaming tools requires the client to re-read the tool list. UI resource changes are served fresh from disk on each open.
- DuckDB and better-sqlite3 on one file behind concurrent HTTP requests: unchanged from today, but the integration suite should exercise concurrent authenticated reads to confirm the read-only attach holds under load.
- Migration count and ordering: new auth migrations follow 0011; keep them additive and reversible-by-design (the corrections and superseded-by invariants are unaffected).

## Sequencing and dependencies

- Phase 0 (data migration) happens first in practice: as soon as the mini can run the app on the open local port, ahead of the auth phases, so all later work is built against real data.
- Phase 1 is the foundation and unblocks the auth work. It is independently shippable with the static-token path.
- Phase 2 depends on Phase 1 (same token shape and key).
- Phase 3 depends on Phase 2 (replaces the stub login) and on the domain decision (RP ID).
- Phase 4 can begin against Phase 2 and complete once Phase 3 lands (the passkey test seam).
- Phase 5 depends on the domain decision and a gated server (Phase 1), and is best validated after Phase 3.
- Phase 6 depends on a working server and tunnel (Phases 1 and 5) and can be built in parallel with Phase 3 and 4.
- Phase 7 depends on Phase 6 (the daemon must exist to restart) and is otherwise independent of the auth phases, so it can land any time after the daemon.

A reasonable shipping order that unlocks value early: Phase 0 (cut over to the mini with real data), Phase 1, then Phase 5 and Phase 6 (a gated remote service over the static token), then Phase 7 (hands-off deploys), then Phase 2, Phase 3, and Phase 4 (the full interactive passkey experience), with hardening folded in as noted.

## Non-goals

- Multi-user, roles, or organizations.
- A hosted or third-party authorization server (self-hosted by choice).
- Cloud compute or a managed database.
- Replacing the existing `ui://` iframe surfaces; the auth pages are a separate server-rendered render path that shares only the token layer.
- Prescriptive financial features; this plan is hosting and auth only.
- Storing runtime secrets in GitHub or injecting them through CI/CD; secrets stay on the mini.
