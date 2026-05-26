import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [greeting, setGreeting] = useState<string>("Loading…");
  const [pingResponse, setPingResponse] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        const text = result.content?.find((c) => c.type === "text")?.text;
        if (text) setGreeting(text);
      };
    },
  });

  async function handlePing() {
    if (!app) return;
    const result = await app.callServerTool({ name: "ping", arguments: {} });
    const text = result.content?.find((c) => c.type === "text")?.text;
    if (text) setPingResponse(text);
  }

  if (error) return <p>Error: {error.message}</p>;
  if (!app) return <p>Connecting…</p>;

  return (
    <div style={{ fontFamily: "system-ui", padding: "1rem" }}>
      <p>{greeting}</p>
      <button onClick={handlePing}>Ping</button>
      {pingResponse && <p>{pingResponse}</p>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
