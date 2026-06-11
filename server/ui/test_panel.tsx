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
  const [isHoldingLoader, setIsHoldingLoader] = useState(true);
  const hasAutoRun = useRef(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsHoldingLoader(false), 3000);
    return () => clearTimeout(timer);
  }, []);

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

  const callReal = useCallback(
    async (name: "get_net_worth" | "get_briefing"): Promise<string> => {
      if (!app) throw new Error("Bridge not connected.");
      const today = new Date().toISOString().split("T")[0]!;
      const result = await app.callServerTool({
        name,
        arguments: { as_of: today, auto_refresh: false },
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
    void run("auto dashboard pair at mount", async () => {
      const [networth, briefing] = await Promise.all([
        callReal("get_net_worth"),
        callReal("get_briefing"),
      ]);
      return `${networth} + ${briefing}`;
    });
  }, [app, callReal, run]);

  if (error) return <ConnectionError message={error.message} />;
  if (!app || isHoldingLoader)
    return <LoadingScreen label={app ? "Loading test panel" : "Connecting"} />;

  return (
    <div className="screen rise stack">
      <p className="note">
        Test panel loaded. The real dashboard pair (get_net_worth + get_briefing) fires
        automatically at mount. Buttons fire on click.
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
        <Btn
          size="sm"
          disabled={busy}
          onClick={() => void run("get_net_worth", () => callReal("get_net_worth"))}
        >
          Call get_net_worth
        </Btn>
        <Btn
          size="sm"
          disabled={busy}
          onClick={() =>
            void run("dashboard pair", async () => {
              const [networth, briefing] = await Promise.all([
                callReal("get_net_worth"),
                callReal("get_briefing"),
              ]);
              return `${networth} + ${briefing}`;
            })
          }
        >
          Call dashboard pair in parallel
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
