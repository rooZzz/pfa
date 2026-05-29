import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

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
    return <p style={styles.error}>Connection error: {error.message}</p>;
  }
  if (!app) {
    return <p style={styles.muted}>Connecting…</p>;
  }
  if (status === "connecting") {
    return <p style={styles.muted}>Connecting Monzo and backfilling history…</p>;
  }
  if (status === "syncing") {
    return <p style={styles.muted}>Syncing Monzo…</p>;
  }

  if (status === "connected") {
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Monzo</h2>
        <p style={styles.success}>{message}</p>
        <div style={styles.actions}>
          <button style={{ ...styles.button, ...styles.confirm }} onClick={handleSync}>
            Sync now
          </button>
          <button
            style={{ ...styles.button, ...styles.cancel }}
            onClick={() => setStatus("form")}
          >
            Reconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Connect Monzo</h2>
      <p style={styles.muted}>
        Run <code>npm run monzo:auth</code> and paste the result below — it carries the
        tokens needed to backfill full history and auto-renew. For a quick test you can
        instead paste a bare access token from the Monzo developer playground. Input is
        sent straight to the local app and never appears in chat.
      </p>
      {status === "error" && errorMessage && <p style={styles.error}>{errorMessage}</p>}
      <textarea
        style={styles.textarea}
        rows={5}
        placeholder='{"client_id":"…","client_secret":"…","access_token":"…","refresh_token":"…"}  — or a bare access token'
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <div style={styles.actions}>
        <button
          style={{ ...styles.button, ...(canConnect ? styles.confirm : styles.disabled) }}
          onClick={handleConnect}
          disabled={!canConnect}
        >
          Connect
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { fontFamily: "system-ui", padding: "1rem", maxWidth: "30rem" },
  heading: { marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" },
  textarea: {
    width: "100%",
    padding: "0.5rem",
    border: "1px solid #ccc",
    borderRadius: "4px",
    fontSize: "0.8125rem",
    fontFamily: "ui-monospace, monospace",
    boxSizing: "border-box",
    resize: "vertical",
  },
  actions: { display: "flex", gap: "0.5rem", marginTop: "0.75rem" },
  button: {
    padding: "0.4rem 1rem",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.875rem",
  },
  confirm: { background: "#0070f3", color: "#fff" },
  disabled: { background: "#ccc", color: "#fff", cursor: "not-allowed" },
  cancel: { background: "#eee", color: "#333" },
  success: { color: "#0a7a0a" },
  error: { color: "#c0392b" },
  muted: { color: "#888", fontSize: "0.8125rem" },
};

createRoot(document.getElementById("root")!).render(<ConnectorsApp />);
