import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NetWorthResult, RealisedLine } from "../net_worth/types.js";
import { Masthead } from "./branding.js";
import { Btn, CompositionBar, Sparkline, Stat } from "./components.js";
import { formatGbp, formatGbpk } from "./format.js";

type NetWorthData = NetWorthResult;

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function ageLabel(days: number | null): string {
  if (days === null) return "no date";
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function sumKind(lines: RealisedLine[], kind: RealisedLine["kind"]): number {
  return lines.filter((l) => l.kind === kind).reduce((sum, l) => sum + l.value_pence, 0);
}

const GROUP_ORDER: { kind: RealisedLine["kind"]; label: string }[] = [
  { kind: "account", label: "Cash" },
  { kind: "asset", label: "Investments" },
  { kind: "pension", label: "Pension" },
  { kind: "property", label: "Property" },
  { kind: "mortgage", label: "Liabilities" },
];

function NetWorthApp() {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
  });

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (!app) return;
      if (isRefresh) setBusy(true);
      else setLoading(true);
      setErrorMessage(null);
      try {
        const today = new Date().toISOString().split("T")[0]!;
        const result = await app.callServerTool({
          name: "get_net_worth",
          arguments: { as_of: today },
        });
        const text = result.content?.find((c: { type: string }) => c.type === "text") as
          | { type: "text"; text: string }
          | undefined;
        if (!text) throw new Error("No response from get_net_worth.");
        setData(JSON.parse(text.text) as NetWorthData);
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        setLoading(false);
        setBusy(false);
      }
    },
    [app],
  );

  useEffect(() => {
    if (app) void load(false);
  }, [app, load]);

  if (error) {
    return (
      <div className="screen rise">
        <p className="note">Connection error: {error.message}</p>
      </div>
    );
  }
  if (!app || loading) {
    return (
      <div className="screen center-min">
        <div className="loading-row">
          <span className="spinner" />
          {app ? "Loading net worth" : "Connecting"}
        </div>
      </div>
    );
  }
  if (errorMessage) {
    return (
      <div className="screen rise stack">
        <p className="note">{errorMessage}</p>
        <div>
          <Btn
            variant="secondary"
            size="sm"
            icon="refresh"
            onClick={() => void load(false)}
          >
            Retry
          </Btn>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const trendVals = data.trend.map((t) => t.realised_total_pence);
  const first = trendVals[0];
  const last = trendVals[trendVals.length - 1];
  const change = first != null && last != null ? last - first : null;
  const changePct =
    change != null && first ? ((change / Math.abs(first)) * 100).toFixed(1) : null;

  const cash = sumKind(data.realised, "account");
  const investments = sumKind(data.realised, "asset");
  const pension = sumKind(data.realised, "pension");
  const property = sumKind(data.realised, "property");
  const accountCount = data.realised.filter((l) => l.kind === "account").length;

  const composition = [
    { label: "Property", value: property, tone: "accent" as const },
    { label: "Pension", value: pension, tone: "muted" as const },
    { label: "Investments", value: investments, tone: "pos" as const },
    { label: "Cash", value: cash, tone: "pos" as const },
  ];

  const groups = GROUP_ORDER.map((g) => ({
    ...g,
    lines: data.realised.filter((l) => l.kind === g.kind),
  })).filter((g) => g.lines.length > 0);

  const hasContingent = data.contingent.length > 0;

  return (
    <div className="screen rise stack">
      <Masthead
        title="Net worth"
        sub={`As of ${data.as_of}`}
        action={
          <Btn
            variant="secondary"
            size="sm"
            icon="refresh"
            onClick={() => void load(true)}
            disabled={busy}
          >
            {busy ? "Syncing" : "Refresh"}
          </Btn>
        }
      />

      <div>
        <div className="figure-hero">
          {formatGbp(data.realised_total_pence, { whole: true })}
        </div>
        {change != null && (
          <div className={"stat-delta mt-2 " + (change >= 0 ? "pos" : "neg")}>
            {(change >= 0 ? "+" : "") + formatGbp(change, { whole: true })}
            {changePct != null ? ` (${changePct}%)` : ""} over {trendVals.length} months
          </div>
        )}
      </div>

      {trendVals.length > 1 && (
        <div className="card card--chart">
          <Sparkline data={trendVals} height={56} />
        </div>
      )}

      <div className="card">
        <div className="card-label mb-3">Composition</div>
        <CompositionBar rows={composition} />
      </div>

      <div className="grid cols-2">
        <div className="card card-sunken">
          <Stat
            label="Liquid cash"
            value={formatGbpk(cash)}
            delta={`${accountCount} account${accountCount === 1 ? "" : "s"}`}
          />
        </div>
        <div className="card card-sunken">
          <Stat label="Investments" value={formatGbpk(investments)} delta="holdings" />
        </div>
      </div>

      <div className="card card--flush">
        <table className="t compact t--inset">
          {groups.map((group) => {
            const subtotal = group.lines.reduce((sum, l) => sum + l.value_pence, 0);
            return (
              <tbody key={group.kind}>
                <tr className="group-row">
                  <td className="group-name">{group.label}</td>
                  <td className="col-num group-sub">{formatGbp(subtotal)}</td>
                </tr>
                {group.lines.map((line, i) => {
                  const hasPriceMeta = line.kind === "asset" || line.kind === "property";
                  const priceAge = hasPriceMeta ? daysSince(line.price_as_of) : null;
                  const isStale = priceAge != null && priceAge > 30;
                  const age = hasPriceMeta
                    ? ageLabel(priceAge)
                    : ageLabel(daysSince(line.valid_from));
                  return (
                    <tr key={i}>
                      <td>
                        {line.name}
                        {isStale && (
                          <span className="badge warn" style={{ marginLeft: 6 }}>
                            <span className="led" />
                            stale
                          </span>
                        )}
                        <span className="sub">{age}</span>
                      </td>
                      <td
                        className="col-num"
                        style={{
                          color: line.value_pence < 0 ? "var(--negative)" : "var(--ink)",
                        }}
                      >
                        {formatGbp(line.value_pence)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
          <tfoot>
            <tr>
              <td>Total realised</td>
              <td className="col-num">{formatGbp(data.realised_total_pence)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {hasContingent && (
        <div className="stack-2">
          <div className="lhead">
            <h4>Contingent</h4>
            <span className="hint">not owned · excluded from total</span>
          </div>
          <div className="card card-sunken card--flush">
            <table className="t compact t--inset">
              <tbody>
                {data.contingent.map((grant, i) => (
                  <tr key={i}>
                    <td>
                      {grant.unvested_units.toLocaleString()}{" "}
                      {grant.scheme_type.toUpperCase()} units
                      <span className="sub">
                        granted {grant.grant_date} · {grant.basis.replace(/_/g, " ")}
                        {grant.price_per_unit_pence != null
                          ? ` · ${grant.price_per_unit_pence}p / unit`
                          : ""}
                      </span>
                    </td>
                    <td className="col-num">
                      {grant.est_value_pence != null
                        ? formatGbp(grant.est_value_pence)
                        : "unknown"}
                    </td>
                  </tr>
                ))}
              </tbody>
              {data.contingent_total_pence > 0 && (
                <tfoot>
                  <tr>
                    <td>Total contingent (est.)</td>
                    <td className="col-num">{formatGbp(data.contingent_total_pence)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {data.unknown.length > 0 && (
        <div className="note">
          No observations at {data.as_of} for: {data.unknown.join(", ")}.
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<NetWorthApp />);
