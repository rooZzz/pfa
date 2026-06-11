import { useCallback, useEffect, useRef, useState } from "react";
import { Btn } from "./components.js";
import {
  usePfaApp,
  mountScreen,
  toolText,
  LoadingScreen,
  ConnectionError,
} from "./screen.js";

function TestPanel() {
  const { app, error } = usePfaApp();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const hasAutoRun = useRef(false);

  const append = (line: string) =>
    setLog((prev) => [...prev, `${new Date().toISOString().slice(11, 23)} ${line}`]);

  const ping = useCallback(
    async (payloadBytes: number): Promise<string> => {
      if (!app) throw new Error("Bridge not connected.");
      const result = await app.callServerTool({
        name: "ping_test",
        arguments: payloadBytes > 0 ? { payload_bytes: payloadBytes } : {},
      });
      const text = toolText(result) ?? "";
      return `${text.length} chars`;
    },
    [app],
  );

  const run = useCallback(async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    append(`${label}: started`);
    try {
      const summary = await fn();
      append(`${label}: ok (${summary})`);
    } catch (err) {
      append(`${label}: FAILED ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!app || hasAutoRun.current) return;
    hasAutoRun.current = true;
    void run("auto pings at mount", async () => {
      const [a, b] = await Promise.all([ping(0), ping(0)]);
      return `${a} + ${b}`;
    });
  }, [app, ping, run]);

  if (error) return <ConnectionError message={error.message} />;
  if (!app) return <LoadingScreen label="Connecting to host" />;

  return (
    <div className="screen rise stack">
      <p className="note">
        Test panel loaded. Two parallel pings fire automatically at mount, mirroring the
        dashboards. Buttons fire on click.
      </p>
      <div className="stack">
        <Btn
          size="sm"
          disabled={busy}
          onClick={() => void run("ping tiny", () => ping(0))}
        >
          Call ping_test (tiny)
        </Btn>
        <Btn
          size="sm"
          disabled={busy}
          onClick={() => void run("ping 200KB", () => ping(200_000))}
        >
          Call ping_test (200KB payload)
        </Btn>
        <Btn
          size="sm"
          disabled={busy}
          onClick={() =>
            void run("parallel pings", async () => {
              const [a, b] = await Promise.all([ping(0), ping(0)]);
              return `${a} + ${b}`;
            })
          }
        >
          Call ping_test twice in parallel
        </Btn>
      </div>
      <div>
        {log.map((line, index) => (
          <p className="caption" key={index}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

mountScreen(<TestPanel />);
