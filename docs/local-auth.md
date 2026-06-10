# Running the passkey auth flow locally

The OAuth + WebAuthn auth server only activates when `PUBLIC_ORIGIN` is set, and in production it
points at the ngrok domain. To exercise the sign-in, enrolment, success, and error screens on any
machine, point that config at `localhost` instead — browsers treat `localhost` as a secure context,
so platform passkeys (Touch ID, Windows Hello) work without TLS.

The committed, non-secret config lives in [server/config/localhost-auth.env](../server/config/localhost-auth.env).
The dev `npm run` scripts load it last via `PFA_DEV_ENV`, so it wins over anything in your local
`.env` (which holds only secrets and is gitignored). No API keys are needed for the auth flow — the
Anthropic and Etherscan clients are lazily constructed and never touched during sign-in.

The dev config is fully isolated from a production instance so it is safe to run even on the host
that serves production: it binds ports `4100` (MCP) and `4101` (auth) rather than the production
`4000`/`4001`, and it points `PFA_DIR` at a gitignored `server/.localdev/` so the dev SQLite store,
documents, and signing key never touch the real `~/.pfa` data.

## Steps

From `server/`:

```
npm run dev:auth          # generates a local signing key (idempotent) and starts the server
```

This serves the MCP endpoint on `127.0.0.1:4100` and the auth server on `127.0.0.1:4101`.

In a second terminal, enrol a passkey on this machine:

```
npm run dev:auth:enroll   # prints http://localhost:4101/enroll?token=...
```

Open that link, click "Create a passkey", and approve with the platform authenticator. This shows
the enrolment page and its success state.

To drive a real sign-in (the `/login` screen needs a pending OAuth request), point an MCP client at
the local server:

```
npx -y mcp-remote http://localhost:4101/mcp
```

It runs OAuth discovery and opens the styled sign-in card in your browser. Approve with the passkey
to see authenticating → success → redirect; cancel the system prompt instead to see the error state.

To eyeball the static pages without the OAuth dance, with the server running open
`http://localhost:4101/` (landing) and `http://localhost:4101/login` (no `req` — renders the error
page).

Both themes follow the OS appearance; flip System Settings between light and dark and reload.

## Notes

- The local signing key is written under `server/.localdev/` (gitignored). Delete that directory to
  reset enrolment.
- The sign-in card shows the OAuth destination verbatim; locally that is the `mcp-remote` loopback
  callback, which is expected.
- This is the same code path as production — only `PUBLIC_ORIGIN`/`RP_ID` differ.
