import { useState } from "react";
import { Masthead } from "../branding.js";
import { ActionBar, Badge, Btn, Icon } from "../components.js";
import { LoadingScreen, toolText } from "../screen.js";
import type { App } from "../screen.js";

type MonzoStatus = "form" | "connecting" | "connected" | "syncing" | "error";

type ConnectArgs = {
  access_token: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
};

function parseConnectInput(raw: string): ConnectArgs {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.access_token !== "string" || parsed.access_token === "") {
      throw new Error("The pasted result has no access_token.");
    }
    const args: ConnectArgs = { access_token: parsed.access_token };
    if (typeof parsed.client_id === "string") args.client_id = parsed.client_id;
    if (typeof parsed.client_secret === "string")
      args.client_secret = parsed.client_secret;
    if (typeof parsed.refresh_token === "string")
      args.refresh_token = parsed.refresh_token;
    return args;
  }
  return { access_token: trimmed };
}

export function MonzoConnector({ app, onBack }: { app: App; onBack: () => void }) {
  const [status, setStatus] = useState<MonzoStatus>("form");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canConnect = input.trim() !== "";

  async function handleConnect() {
    if (!canConnect) return;
    let args: ConnectArgs;
    try {
      args = parseConnectInput(input);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Could not read the input.");
      return;
    }
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const result = await app.callServerTool({ name: "connect_monzo", arguments: args });
      setInput("");
      setMessage(toolText(result) ?? "Done.");
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Connection failed.");
    }
  }

  async function handleSync() {
    setStatus("syncing");
    setErrorMessage(null);
    try {
      const result = await app.callServerTool({ name: "sync_monzo", arguments: {} });
      setMessage(toolText(result) ?? "Done.");
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Sync failed.");
    }
  }

  if (status === "connecting" || status === "syncing") {
    return (
      <LoadingScreen
        rise
        label={
          status === "connecting"
            ? "Connecting Monzo · backfilling history"
            : "Syncing transactions"
        }
      />
    );
  }

  if (status === "connected") {
    return (
      <div className="screen rise">
        <Masthead
          lead={
            <span className="chip-ico chip-ico--accent">
              <Icon name="bank" size={18} />
            </span>
          }
          title="Monzo"
          sub="high-trust ingestion · manual sync"
          titleSize="var(--text-md)"
          action={
            <Badge tone="ok" led>
              connected
            </Badge>
          }
        />
        <div className="card card-sunken mt-4">
          <p className="note">{message}</p>
        </div>
        <ActionBar
          secondary={
            <>
              <Btn variant="ghost" size="sm" onClick={onBack}>
                All connectors
              </Btn>
              <Btn
                variant="ghost"
                icon="plug"
                onClick={() => {
                  setStatus("form");
                  setInput("");
                  setMessage(null);
                }}
              >
                Reconnect
              </Btn>
            </>
          }
          primary={
            <Btn variant="primary" icon="sync" onClick={() => void handleSync()}>
              Sync now
            </Btn>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen rise">
      <Masthead
        lead={
          <span className="chip-ico chip-ico--muted">
            <Icon name="bank" size={18} />
          </span>
        }
        title="Connect Monzo"
        titleSize="var(--text-md)"
      />
      <p className="note mt-3 mb-4">
        Run <span className="mono">npm run monzo:auth</span> and paste the result below.
      </p>
      {status === "error" && errorMessage && <p className="note mb-4">{errorMessage}</p>}
      <label className="field-label">OAuth tokens or bare access token</label>
      <textarea
        className="textarea"
        rows={5}
        spellCheck={false}
        placeholder={
          '{"client_id":"…","client_secret":"…","access_token":"…","refresh_token":"…"}\n— or a bare access token'
        }
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <p className="caption row-2 mt-3" style={{ gap: "var(--space-1)" }}>
        <Icon name="info" size={12} /> credentials stay local
      </p>
      <ActionBar
        secondary={
          <Btn variant="ghost" size="sm" onClick={onBack}>
            All connectors
          </Btn>
        }
        primary={
          <Btn
            variant="primary"
            icon="check"
            onClick={() => void handleConnect()}
            disabled={!canConnect}
          >
            Connect
          </Btn>
        }
      />
    </div>
  );
}
