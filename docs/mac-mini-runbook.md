# Mac mini operations runbook

Host provisioning for the pfa MCP server. Implements the host/ops layer of
[remote-hosting-and-auth-plan.md](remote-hosting-and-auth-plan.md) (Phases 0, 5, 6, 7). The
app auth code (Phases 1-4) lands on top of this and is out of scope here.

All host setup is driven by `ops/mac-mini/provision.sh`, an idempotent script with one
subcommand per concern. Run subcommands one at a time and check the result before moving on.

## Provisioning status (mac-mini, as of 2026-06-09)

Done on the mini and verified:

- Host renamed to `mac-mini` (LocalHostName/ComputerName/HostName); reachable as
  `mac-mini.local`.
- `ssh` - Remote Login on, password auth disabled, hardened drop-in. Key-based SSH from the
  second machine confirmed working.
- `user` - `_pfa` service account and directories created.
- `toolchain` - Node 22 and ngrok installed via Homebrew.
- `bootstrap` - app cloned to `/Users/_pfa/pfa`, `.env` copied, deps built. `/Users/_pfa/.pfa`
  is an empty fresh store (`integrity_check ok`).
- `power` - sleep disabled, restart-after-power-loss on, NTP on, log rotation installed.
- `agents` - server + nightly-backup LaunchDaemons loaded; server running on `127.0.0.1:4000`
  (a POST probe returns 406, which is the healthy MCP response); sudoers restart entry
  installed.
- `runner` - self-hosted runner registered to `rooZzz/pfa` (labels `self-hosted,mini,deploy`)
  and running as a daemon; shows Idle in repo Settings > Actions > Runners.

Remaining (intended for the second machine / later):

- Merge this branch (or cherry-pick `deploy.yml`) to the default branch so `release: published`
  can trigger the deploy. While `deploy.yml` lives only on a feature branch it will not fire.
  Test with a `workflow_dispatch` run first.
- Migrate the real database from the other machine (see Data migration below). The store is
  empty until then.
- ngrok stays parked until app Phase 1 introduces the authenticated port `4001` and `/health`;
  then add the authtoken, set the reserved domain, and load `com.pfa.ngrok`.
- App auth (Phases 1-4 of the design doc) is not started.

## What runs where

- Service account `_pfa` owns the app, the data, and the runner. The server, ngrok, runner,
  and nightly backup run as LaunchDaemons (system domain) under `UserName = _pfa`, so they
  start at boot with no login. FileVault is on, so auto-login is neither used nor possible.
- App tree: `/Users/_pfa/pfa`. Data: `/Users/_pfa/.pfa` (`data.sqlite` + `documents/`).
- Server binds `127.0.0.1:4000` (open local port, today's behaviour, unchanged). The
  authenticated port `4001` and `/health` arrive with app Phase 1; ngrok forwards to `4001`.
- Logs: `/Users/_pfa/Library/Logs/pfa/`.

## Inputs you must supply

- The client machine's SSH public key (to authorise inbound SSH).
- An ngrok authtoken and a reserved public domain. The domain is also the permanent WebAuthn
  RP ID, so choose it before any passkey work.
- Nothing else: the runner is registered with a short-lived token minted via `gh` (you are
  already logged in as `rooZzz`, which has admin on the repo).

## Bring-up order

Run from a Terminal logged in as `matty`. Each privileged step needs your password.

1. SSH access
   ```
   sudo ops/mac-mini/provision.sh ssh
   ```
   Then authorise the client key (replace with the real public key):
   ```
   pbpaste >> ~/.ssh/authorized_keys   # or paste the key into the file
   ```
   If `systemsetup -setremotelogin on` reports an authorisation error, grant the Terminal
   Full Disk Access (Settings > Privacy & Security) or toggle Remote Login on in
   Settings > General > Sharing. Verify from another machine:
   `ssh matty@mac-mini.local` (key only; password auth is refused).

2. Service user and directories
   ```
   sudo ops/mac-mini/provision.sh user
   ```
   Then authorise the client key for `_pfa` too if you want to SSH in as the service user:
   append it to `/Users/_pfa/.ssh/authorized_keys`.

3. Toolchain (Node 22 + ngrok). Runs Homebrew as `matty`, no root needed:
   ```
   ops/mac-mini/provision.sh toolchain
   ```

4. Seed the app and build. This clones a clean copy of the repo (default ref `main`, override
   with `PFA_REF`) into `/Users/_pfa/pfa` using your GitHub access, copies the API keys from
   your `server/.env` once (override with `PFA_ENV_SOURCE`), and builds as `_pfa`. It leaves
   `/Users/_pfa/.pfa` empty - a fresh `data.sqlite` is created on first start; real data is
   migrated separately (see Data migration below).
   ```
   sudo ops/mac-mini/provision.sh bootstrap
   ```

5. Power, clock, log rotation
   ```
   sudo ops/mac-mini/provision.sh power
   ```
   No auto-login step: services are LaunchDaemons and FileVault blocks auto-login anyway.

6. LaunchDaemons (server + nightly backup load now; ngrok is written but left unloaded until
   the Phase 1 auth port exists). This also installs the sudoers entry that lets `_pfa`
   restart the server during a deploy.
   ```
   sudo ops/mac-mini/provision.sh agents
   ```

7. GitHub Actions runner
   ```
   sudo ops/mac-mini/provision.sh runner
   ```

8. Verify
   ```
   ops/mac-mini/provision.sh verify
   ```

## Data migration (separate, from the other machine)

The real database lives on another machine. Once SSH is up (step 1), with both servers
stopped so the SQLite file is quiescent:

```
ssh matty@mac-mini.local sudo launchctl bootout system/com.pfa.server
rsync -avz ~/.pfa/ matty@mac-mini.local:/tmp/pfa-import/
ssh matty@mac-mini.local 'sudo rsync -a /tmp/pfa-import/ /Users/_pfa/.pfa/ && sudo chown -R _pfa:staff /Users/_pfa/.pfa'
ssh matty@mac-mini.local sudo launchctl bootstrap system /Library/LaunchDaemons/com.pfa.server.plist
```

Then on the mini confirm `PRAGMA integrity_check` is clean and a `get_net_worth` read matches
the source. After cutover the mini is the sole writer; never run two writers against copies.

## ngrok (enable with app Phase 1)

```
sudo -H -u _pfa /opt/homebrew/bin/ngrok config add-authtoken <TOKEN>
```
The `-H` matters: without it the authtoken is written to the wrong home. Edit
`/Users/_pfa/Library/Application Support/ngrok/ngrok.yml`, set the tunnel's `domain` to the
reserved domain, confirm `addr` is the authenticated port. Then load the tunnel:
```
sudo launchctl bootstrap system /Library/LaunchDaemons/com.pfa.ngrok.plist
```
Do not point the tunnel at the open port 4000; it is unauthenticated until Phase 1 gates 4001.

## Deploys

`.github/workflows/deploy.yml` runs on `release: published` (and `workflow_dispatch` with a
tag). The self-hosted runner, as `_pfa`, backs up the data store, snapshots the current
source for rollback, syncs the released tag into `/Users/_pfa/pfa`, runs `npm ci` + build,
restarts the server agent (migrations run at startup), and health-checks `:4000`. Any failure
restores the previous source and the pre-deploy DB backup, then re-restarts. PR CI
(`.github/workflows/ci.yml`) stays on GitHub-hosted runners, unchanged.

The runner and the app both run as `_pfa`. The deploy restarts the server daemon with
`sudo launchctl kickstart -k system/com.pfa.server`, allowed without a password by the
`/etc/sudoers.d/pfa-deploy` entry installed in the `agents` step (scoped to exactly that one
command).

## Common operations

- Restart the server: `sudo launchctl kickstart -k system/com.pfa.server`
- Tail logs: `tail -f /Users/_pfa/Library/Logs/pfa/server.log`
- Kill switch (drop the public tunnel, leave data untouched):
  `sudo launchctl bootout system/com.pfa.ngrok`
- Stop the server: `sudo launchctl bootout system/com.pfa.server`
- Restore data: stop the server, copy a `predeploy-*.sqlite` or `data-*.sqlite` from
  `/Users/_pfa/backups/` over `/Users/_pfa/.pfa/data.sqlite`, restart.
- Re-register the runner: `sudo ops/mac-mini/provision.sh runner` (uses `--replace`).

## FileVault and unattended recovery

FileVault is on, so the services run as LaunchDaemons (auto-login is disabled under FileVault).
A process crash recovers with no intervention (KeepAlive). A cold boot or power-loss boot
halts at the disk-unlock screen; once anyone unlocks it there, the daemons start with no login
needed, so recovery after a hard power event is one unlock, not a full interactive login.
Recommended: keep FileVault on (the data is sensitive) and add a UPS to bridge brief outages.
For a planned reboot, use `sudo fdesetup authrestart` to unlock once automatically. The future
OAuth signing key (app Phase 1) must live in a `0600` file, not the login Keychain, since a
LaunchDaemon has no Keychain session.
