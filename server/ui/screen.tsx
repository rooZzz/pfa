import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

export type App = NonNullable<ReturnType<typeof useApp>["app"]>;

export function usePfaApp() {
  return useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
  });
}

export function toolText(result: { content?: { type: string }[] }): string | null {
  const block = result.content?.find((c) => c.type === "text") as
    | { type: "text"; text: string }
    | undefined;
  return block?.text ?? null;
}

export function parseToolJson<T>(
  result: { content?: { type: string }[] },
  toolName: string,
): T {
  const text = toolText(result);
  if (text == null) throw new Error(`No response from ${toolName}.`);
  return JSON.parse(text) as T;
}

export function ConnectionError({ message }: { message: string }) {
  return (
    <div className="screen rise">
      <p className="note">Connection error: {message}</p>
    </div>
  );
}

export function LoadingScreen({
  label,
  rise = false,
}: {
  label: string;
  rise?: boolean;
}) {
  return (
    <div className={(rise ? "screen rise" : "screen") + " center-min"}>
      <div className="loading-row">
        <span className="spinner" />
        {label}
      </div>
    </div>
  );
}

export function ErrorScreen({
  message,
  action,
}: {
  message: string | null;
  action: ReactNode;
}) {
  return (
    <div className="screen rise stack">
      <p className="note">{message}</p>
      <div>{action}</div>
    </div>
  );
}

export function mountScreen(node: ReactNode) {
  createRoot(document.getElementById("root")!).render(node);
}
