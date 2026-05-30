import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Masthead } from "./branding.js";
import { Badge, Btn, Icon } from "./components.js";

type Status = "form" | "connecting" | "connected" | "syncing" | "error";

type ConnectArgs = {
  access_token: string;
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
};

function textOf(result: { content?: { type: string }[] }): string {
  const block = result.content?.find((c) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return block?.text ?? "Done.";
}

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

function ConnectorsApp() {
  const [status, setStatus] = useState<Status>("form");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
  });

  const canConnect = input.trim() !== "";

  async function handleConnect() {
    if (!app || !canConnect) return;
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
      setMessage(textOf(result));
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Connection failed.");
    }
  }

  async function handleSync() {
    if (!app) return;
    setStatus("syncing");
    setErrorMessage(null);
    try {
      const result = await app.callServerTool({ name: "sync_monzo", arguments: {} });
      setMessage(textOf(result));
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Sync failed.");
    }
  }

  if (error) {
    return (
      <div className="screen rise">
        <p className="note">Connection error: {error.message}</p>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="screen center-min">
        <div className="loading-row">
          <span className="spinner" />
          Connecting
        </div>
      </div>
    );
  }
  if (status === "connecting" || status === "syncing") {
    return (
      <div className="screen rise center-min">
        <div className="loading-row">
          <span className="spinner" />
          {status === "connecting"
            ? "Connecting Monzo · backfilling history"
            : "Syncing transactions"}
        </div>
      </div>
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

        <p className="note accent" style={{ margin: "var(--space-4) 0" }}>
          {message}
        </p>

        <div className="row row-2">
          <Btn variant="primary" icon="sync" onClick={() => void handleSync()}>
            Sync now
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
        </div>
      </div>
    );
  }

  return (
    <div className="screen rise">
      <Masthead
        lead={
          <span className="chip-ico chip-ico--muted">
            <Icon name="plug" size={18} />
          </span>
        }
        title="Connect Monzo"
        titleSize="var(--text-md)"
      />

      <p className="note accent" style={{ margin: "var(--space-3) 0 var(--space-4)" }}>
        Run <span className="mono">npm run monzo:auth</span> and paste the result below.
        For a quick test you can paste a bare access token instead. Input goes straight to
        the local app — it never appears in chat.
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
      <div className="row-between mt-3">
        <span className="eyebrow row-2" style={{ gap: 5 }}>
          <Icon name="info" size={12} /> credentials stay local
        </span>
        <Btn
          variant="primary"
          icon="check"
          onClick={() => void handleConnect()}
          disabled={!canConnect}
        >
          Connect
        </Btn>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<ConnectorsApp />);
