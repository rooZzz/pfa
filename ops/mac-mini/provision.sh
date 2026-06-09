#!/usr/bin/env bash
set -euo pipefail

SERVICE_USER="_pfa"
SERVICE_HOME="/Users/${SERVICE_USER}"
APP_DIR="${SERVICE_HOME}/pfa"
DATA_DIR="${SERVICE_HOME}/.pfa"
LOG_DIR="${SERVICE_HOME}/Library/Logs/pfa"
BIN_DIR="${SERVICE_HOME}/bin"
NGROK_DIR="${SERVICE_HOME}/Library/Application Support/ngrok"
RUNNER_DIR="${SERVICE_HOME}/actions-runner"
BACKUP_DIR="${SERVICE_HOME}/backups"
DAEMON_DIR="/Library/LaunchDaemons"
SUDOERS_FILE="/etc/sudoers.d/pfa-deploy"
LAUNCHCTL="/bin/launchctl"

REF="${PFA_REF:-main}"
ENV_SOURCE="${PFA_ENV_SOURCE:-/Users/matty/dev/pfa/server/.env}"
REPO="rooZzz/pfa"
REPO_URL="https://github.com/${REPO}"
PORT="4000"
AUTH_PORT="4001"
NODE_BIN="/opt/homebrew/opt/node@22/bin"
BREW_BIN="/opt/homebrew/bin"
RUNTIME_PATH="${NODE_BIN}:${BREW_BIN}:/usr/bin:/bin:/usr/sbin:/sbin"

INVOKER="${SUDO_USER:-$(id -un)}"

say() { printf '\n>> %s\n' "$*"; }
need_root() { [ "$(id -u)" -eq 0 ] || { echo "this step needs sudo: sudo $0 $CMD" >&2; exit 1; }; }
as_invoker() { if [ "$(id -un)" = "$INVOKER" ]; then "$@"; else sudo -u "$INVOKER" "$@"; fi; }
as_service() { sudo -H -u "$SERVICE_USER" "$@"; }

cmd_ssh() {
  need_root
  say "Enabling Remote Login"
  systemsetup -setremotelogin on || {
    echo "systemsetup failed (likely missing Full Disk Access). Enable Remote Login in Settings > General > Sharing." >&2
  }
  say "Writing hardened sshd drop-in"
  install -d -m 755 /etc/ssh/sshd_config.d
  cat > /etc/ssh/sshd_config.d/10-pfa.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin no
EOF
  chmod 644 /etc/ssh/sshd_config.d/10-pfa.conf
  say "Done. Add the client machine public key to ~/.ssh/authorized_keys for each login user."
  echo "Reach this box as: ${INVOKER}@$(scutil --get LocalHostName).local"
}

cmd_user() {
  need_root
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    say "Service user ${SERVICE_USER} already exists"
  else
    say "Creating service user ${SERVICE_USER}"
    sysadminctl -addUser "$SERVICE_USER" -fullName "pfa service" -home "$SERVICE_HOME" -shell /bin/zsh
  fi
  say "Creating service directories"
  install -d -o "$SERVICE_USER" -g staff -m 700 "${SERVICE_HOME}/.ssh"
  install -d -o "$SERVICE_USER" -g staff -m 755 "$LOG_DIR" "$BIN_DIR" "$BACKUP_DIR" "$DATA_DIR"
  install -d -o "$SERVICE_USER" -g staff -m 755 "$NGROK_DIR"
  touch "${SERVICE_HOME}/.ssh/authorized_keys"
  chown "$SERVICE_USER":staff "${SERVICE_HOME}/.ssh/authorized_keys"
  chmod 600 "${SERVICE_HOME}/.ssh/authorized_keys"
  say "Done"
}

cmd_toolchain() {
  say "Installing Node 22 and ngrok via Homebrew (as ${INVOKER})"
  as_invoker "${BREW_BIN}/brew" install node@22 ngrok
  say "Node: $(${NODE_BIN}/node -v)  ngrok: $(${BREW_BIN}/ngrok --version 2>/dev/null || echo missing)"
}

cmd_bootstrap() {
  need_root
  say "Cloning ${REPO} (${REF}) into ${APP_DIR}"
  local tmp; tmp="$(as_invoker mktemp -d)"
  as_invoker git clone --depth 1 --branch "$REF" "git@github.com:${REPO}.git" "${tmp}/pfa"
  install -d -o "$SERVICE_USER" -g staff -m 755 "$APP_DIR"
  rsync -a --delete \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude 'server/dist' \
    "${tmp}/pfa/" "${APP_DIR}/"
  rm -rf "$tmp"
  if [ -f "$ENV_SOURCE" ]; then
    say "Installing server/.env from ${ENV_SOURCE} (one-time secret copy)"
    cp "$ENV_SOURCE" "${APP_DIR}/server/.env"
  else
    echo "WARNING: ${ENV_SOURCE} not found; create ${APP_DIR}/server/.env manually before first start" >&2
  fi
  chown -R "$SERVICE_USER":staff "$APP_DIR"
  chmod 600 "${APP_DIR}/server/.env" 2>/dev/null || true
  say "Installing deps and building (as ${SERVICE_USER}, Node 22)"
  as_service env PATH="$RUNTIME_PATH" bash -c "cd '${APP_DIR}/server' && '${NODE_BIN}/npm' ci && '${NODE_BIN}/npm' run build"
  say "Done"
}

write_daemon() {
  local label="$1" out="$2"; shift 2
  cat > "$out" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>UserName</key><string>${SERVICE_USER}</string>
  <key>GroupName</key><string>staff</string>
  <key>ProgramArguments</key>
  <array>
$(for a in "$@"; do printf '    <string>%s</string>\n' "$a"; done)
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>WorkingDirectory</key><string>${PLIST_WORKDIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${RUNTIME_PATH}</string>
    <key>HOME</key><string>${SERVICE_HOME}</string>
${PLIST_EXTRA_ENV:-}
  </dict>
  <key>StandardOutPath</key><string>${PLIST_LOG}</string>
  <key>StandardErrorPath</key><string>${PLIST_LOG}</string>
</dict>
</plist>
EOF
  chown root:wheel "$out"
  chmod 644 "$out"
}

cmd_agents() {
  need_root
  say "Writing server LaunchDaemon"
  PLIST_WORKDIR="${APP_DIR}/server" PLIST_LOG="${LOG_DIR}/server.log" \
    PLIST_EXTRA_ENV="    <key>PFA_DIR</key><string>${DATA_DIR}</string>
    <key>PORT</key><string>${PORT}</string>" \
    write_daemon com.pfa.server "${DAEMON_DIR}/com.pfa.server.plist" \
    "${NODE_BIN}/npm" run start:http

  say "Writing backup script and LaunchDaemon"
  cat > "${BIN_DIR}/pfa-backup.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
stamp="\$(date +%Y%m%d-%H%M%S)"
/usr/bin/sqlite3 "${DATA_DIR}/data.sqlite" ".backup '${BACKUP_DIR}/data-\${stamp}.sqlite'"
/usr/bin/rsync -a --delete "${DATA_DIR}/documents/" "${BACKUP_DIR}/documents/"
/usr/bin/find "${BACKUP_DIR}" -name 'data-*.sqlite' -mtime +14 -delete
EOF
  chown "$SERVICE_USER":staff "${BIN_DIR}/pfa-backup.sh"
  chmod 744 "${BIN_DIR}/pfa-backup.sh"
  cat > "${DAEMON_DIR}/com.pfa.backup.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.pfa.backup</string>
  <key>UserName</key><string>${SERVICE_USER}</string>
  <key>GroupName</key><string>staff</string>
  <key>ProgramArguments</key>
  <array>
    <string>${BIN_DIR}/pfa-backup.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>${LOG_DIR}/backup.log</string>
  <key>StandardErrorPath</key><string>${LOG_DIR}/backup.log</string>
</dict>
</plist>
EOF
  chown root:wheel "${DAEMON_DIR}/com.pfa.backup.plist"
  chmod 644 "${DAEMON_DIR}/com.pfa.backup.plist"

  say "Writing ngrok config and LaunchDaemon (left unloaded until the auth port exists)"
  cat > "${NGROK_DIR}/ngrok.yml" <<EOF
version: "2"
log: ${LOG_DIR}/ngrok.log
log_level: info
tunnels:
  pfa:
    proto: http
    addr: ${AUTH_PORT}
    domain: REPLACE_WITH_RESERVED_DOMAIN
EOF
  chown "$SERVICE_USER":staff "${NGROK_DIR}/ngrok.yml"
  PLIST_WORKDIR="${SERVICE_HOME}" PLIST_LOG="${LOG_DIR}/ngrok.log" PLIST_EXTRA_ENV="" \
    write_daemon com.pfa.ngrok "${DAEMON_DIR}/com.pfa.ngrok.plist" \
    "${BREW_BIN}/ngrok" start --all --config "${NGROK_DIR}/ngrok.yml"

  say "Granting ${SERVICE_USER} permission to restart the server (deploy needs this)"
  cat > "$SUDOERS_FILE" <<EOF
${SERVICE_USER} ALL=(root) NOPASSWD: ${LAUNCHCTL} kickstart -k system/com.pfa.server
EOF
  chown root:wheel "$SUDOERS_FILE"
  chmod 440 "$SUDOERS_FILE"
  visudo -cf "$SUDOERS_FILE" >/dev/null

  say "Loading server and backup daemons (system domain)"
  "$LAUNCHCTL" bootstrap system "${DAEMON_DIR}/com.pfa.server.plist" || \
    "$LAUNCHCTL" kickstart -k system/com.pfa.server
  "$LAUNCHCTL" bootstrap system "${DAEMON_DIR}/com.pfa.backup.plist" || true
  say "Done. Enable ngrok later with: sudo launchctl bootstrap system ${DAEMON_DIR}/com.pfa.ngrok.plist"
}

cmd_runner() {
  need_root
  if [ ! -x "${RUNNER_DIR}/run.sh" ]; then
    say "Downloading actions runner"
    local tag url
    tag="$(as_invoker ${BREW_BIN}/gh api repos/actions/runner/releases/latest --jq .tag_name)"
    url="https://github.com/actions/runner/releases/download/${tag}/actions-runner-osx-arm64-${tag#v}.tar.gz"
    install -d -o "$SERVICE_USER" -g staff -m 755 "$RUNNER_DIR"
    as_service bash -c "cd '${RUNNER_DIR}' && curl -fsSL -o runner.tar.gz '${url}' && tar xzf runner.tar.gz && rm runner.tar.gz"
  fi
  if [ ! -f "${RUNNER_DIR}/.runner" ]; then
    say "Registering runner with ${REPO}"
    local token
    token="$(as_invoker ${BREW_BIN}/gh api -X POST repos/${REPO}/actions/runners/registration-token --jq .token)"
    as_service bash -c "cd '${RUNNER_DIR}' && ./config.sh --unattended --replace --url '${REPO_URL}' --token '${token}' --name mini --labels self-hosted,mini,deploy --work _work"
  else
    say "Runner already registered"
  fi
  say "Writing runner LaunchDaemon"
  PLIST_WORKDIR="${RUNNER_DIR}" PLIST_LOG="${LOG_DIR}/runner.log" PLIST_EXTRA_ENV="" \
    write_daemon com.pfa.runner "${DAEMON_DIR}/com.pfa.runner.plist" \
    "${RUNNER_DIR}/run.sh"
  "$LAUNCHCTL" bootstrap system "${DAEMON_DIR}/com.pfa.runner.plist" || \
    "$LAUNCHCTL" kickstart -k system/com.pfa.runner
  say "Done"
}

cmd_power() {
  need_root
  say "Disabling sleep and enabling restart after power loss"
  pmset -a sleep 0 disablesleep 1 powernap 0 autorestart 1 womp 1
  say "Enabling network time"
  systemsetup -setusingnetworktime on || true
  systemsetup -setnetworktimeserver time.apple.com || true
  say "Writing log rotation policy"
  cat > /etc/newsyslog.d/pfa.conf <<EOF
${LOG_DIR}/server.log ${SERVICE_USER}:staff 644 7 5000 * J
${LOG_DIR}/ngrok.log ${SERVICE_USER}:staff 644 7 5000 * J
${LOG_DIR}/runner.log ${SERVICE_USER}:staff 644 7 5000 * J
${LOG_DIR}/backup.log ${SERVICE_USER}:staff 644 7 2000 * J
EOF
  chmod 644 /etc/newsyslog.d/pfa.conf
  say "pmset state:"; pmset -g | grep -E 'sleep|autorestart|womp' || true
  echo
  echo "NOTE: services run as LaunchDaemons, so no auto-login is needed (FileVault blocks it anyway)."
  echo "NOTE: FileVault is on, so a cold or power-loss boot needs one manual unlock; daemons start after it."
}

cmd_verify() {
  say "Remote Login"; systemsetup -getremotelogin 2>/dev/null || echo "n/a (needs root)"
  say "Power"; pmset -g | grep -E 'sleep|autorestart' || true
  say "Server daemon"; "$LAUNCHCTL" print system/com.pfa.server 2>/dev/null | grep -E 'state =|pid =' || echo "not loaded"
  say "MCP endpoint"; curl -s -o /dev/null -w 'http %{http_code}\n' -X POST "http://127.0.0.1:${PORT}/mcp" -H 'content-type: application/json' -d '{}' || echo "no response"
  say "Data store"; /usr/bin/sqlite3 "${DATA_DIR}/data.sqlite" 'PRAGMA integrity_check;' 2>/dev/null || echo "no db yet"
  say "Runner"; [ -f "${RUNNER_DIR}/.runner" ] && echo "registered" || echo "not registered"
}

cmd_import() {
  need_root
  local db="${PFA_IMPORT_DB:-/tmp/pfa-data.sqlite}"
  local docs="${PFA_IMPORT_DOCS:-/tmp/pfa-documents}"
  [ -f "$db" ] || { echo "staged database not found at ${db}; stage it from the source machine first (see runbook Data migration)" >&2; exit 1; }
  if [ -f "${DATA_DIR}/data.sqlite" ]; then
    local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
    install -d -o "$SERVICE_USER" -g staff -m 755 "$BACKUP_DIR"
    say "Backing up current store to ${BACKUP_DIR}/preimport-${stamp}.sqlite"
    /usr/bin/sqlite3 "${DATA_DIR}/data.sqlite" ".backup '${BACKUP_DIR}/preimport-${stamp}.sqlite'"
  fi
  say "Stopping server"
  "$LAUNCHCTL" bootout system/com.pfa.server 2>/dev/null || true
  say "Installing imported database"
  install -o "$SERVICE_USER" -g staff -m 644 "$db" "${DATA_DIR}/data.sqlite"
  install -d -o "$SERVICE_USER" -g staff -m 755 "${DATA_DIR}/documents"
  if [ -d "$docs" ]; then
    say "Importing documents"
    rsync -a "${docs}/" "${DATA_DIR}/documents/"
  else
    echo "WARNING: staged documents dir ${docs} not found; importing database only" >&2
  fi
  chown -R "$SERVICE_USER":staff "$DATA_DIR"
  say "Integrity check (store quiescent, before start)"
  /usr/bin/sqlite3 "${DATA_DIR}/data.sqlite" 'PRAGMA integrity_check;'
  say "Row counts (compare with the source)"
  /usr/bin/sqlite3 "${DATA_DIR}/data.sqlite" "select 'accounts='||count(*) from accounts; select 'transactions='||count(*) from transactions; select 'documents='||count(*) from documents;"
  say "Starting server (migrations run at startup)"
  "$LAUNCHCTL" bootstrap system "${DAEMON_DIR}/com.pfa.server.plist" || \
    "$LAUNCHCTL" kickstart -k system/com.pfa.server
  say "Cleaning up staged files"
  rm -f "$db"; rm -rf "$docs"
  say "Done. The mini is now the sole writer; stop the server on the source machine."
}

CMD="${1:-}"
case "$CMD" in
  ssh) cmd_ssh ;;
  user) cmd_user ;;
  toolchain) cmd_toolchain ;;
  bootstrap) cmd_bootstrap ;;
  power) cmd_power ;;
  agents) cmd_agents ;;
  runner) cmd_runner ;;
  verify) cmd_verify ;;
  import) cmd_import ;;
  all) need_root; cmd_ssh; cmd_user; cmd_toolchain; cmd_bootstrap; cmd_power; cmd_agents; cmd_runner; cmd_verify ;;
  *) echo "usage: sudo $0 {ssh|user|toolchain|bootstrap|power|agents|runner|verify|import|all}" >&2; exit 2 ;;
esac
