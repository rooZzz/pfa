import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type {
  ContingentLine,
  NetWorthResult,
  RealisedLine,
  UnscheduledLine,
} from "../net_worth/types.js";
import { Masthead } from "./branding.js";
import { Btn, CompositionBar, CoverageGrid, Sparkline, Stat } from "./components.js";
import { DataTable } from "./data_table.js";
import type { DataGroup } from "./data_table.js";
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

const staleBadge = (
  <span className="badge warn" style={{ marginLeft: 6 }}>
    <span className="led" />
    stale
  </span>
);

function realisedRowLabel(line: RealisedLine): ReactNode {
  const hasPriceMeta = line.kind === "asset" || line.kind === "property";
  const priceAge = hasPriceMeta ? daysSince(line.price_as_of) : null;
  const isStale = priceAge != null && priceAge > 30;
  const age = hasPriceMeta ? ageLabel(priceAge) : ageLabel(daysSince(line.valid_from));
  return (
    <>
      {line.name}
      <span className="sub sub-inline">{age}</span>
      {isStale && staleBadge}
    </>
  );
}

function vestRowLabel(line: ContingentLine): ReactNode {
  const priceAge = daysSince(line.price_as_of ?? undefined);
  const isStale = priceAge != null && priceAge > 30;
  const identifier = line.ticker ?? line.asset_name ?? "unlinked";
  return (
    <>
      {line.units.toLocaleString()} {line.scheme_type.toUpperCase()} · {identifier}
      <span className="sub sub-inline">
        vests {line.vest_date}
        {line.price_per_unit_pence != null
          ? ` · ${formatGbp(line.price_per_unit_pence)}/unit`
          : " · no price"}
        {line.strike_pence != null ? ` · strike ${formatGbp(line.strike_pence)}` : ""}
      </span>
      {isStale && staleBadge}
    </>
  );
}

function unscheduledRowLabel(line: UnscheduledLine): ReactNode {
  const identifier = line.ticker ?? line.asset_name ?? "unlinked";
  return (
    <>
      {line.units.toLocaleString()} {line.scheme_type.toUpperCase()} · {identifier}
      <span className="sub sub-inline">vest dates not recorded</span>
    </>
  );
}

function buildRealisedGroups(realised: RealisedLine[]): DataGroup[] {
  return GROUP_ORDER.map((g) => ({
    kind: g.kind,
    label: g.label,
    lines: realised.filter((l) => l.kind === g.kind),
  }))
    .filter((g) => g.lines.length > 0)
    .map((g) => ({
      key: g.kind,
      label: g.label,
      truncate: 5,
      sortByValue: true,
      rows: g.lines.map((line, i) => ({
        key: `${g.kind}-${i}`,
        label: realisedRowLabel(line),
        valuePence: line.value_pence,
      })),
    }));
}

function buildVestGroups(
  contingent: ContingentLine[],
  unscheduled: UnscheduledLine[],
): DataGroup[] {
  const byYear = new Map<string, ContingentLine[]>();
  for (const line of contingent) {
    const year = line.vest_date.split("-")[0]!;
    const bucket = byYear.get(year);
    if (bucket) bucket.push(line);
    else byYear.set(year, [line]);
  }

  const groups: DataGroup[] = [...byYear.entries()].map(([year, lines]) => ({
    key: year,
    label: year,
    rows: lines.map((line, i) => ({
      key: `${year}-${i}`,
      label: vestRowLabel(line),
      valuePence: line.projected_value_pence,
    })),
  }));

  if (unscheduled.length > 0) {
    groups.push({
      key: "unscheduled",
      label: "Not yet scheduled",
      subtotalPence: null,
      rows: unscheduled.map((line, i) => ({
        key: `unscheduled-${i}`,
        label: unscheduledRowLabel(line),
        valuePence: null,
        display: "—",
        tone: "muted",
      })),
    });
  }

  return groups;
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

  const realisedGroups = buildRealisedGroups(data.realised);
  const vestGroups = buildVestGroups(data.contingent, data.contingent_unscheduled);
  const hasContingent = vestGroups.length > 0;

  return (
    <div className="screen rise stack">
      <Masthead
        tight
        title="Net worth"
        sub={`As of ${data.as_of}`}
        action={
          <div className="screen-actions">
            {data.coverage.length > 0 && <CoverageGrid months={data.coverage} />}
            <Btn
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => void load(true)}
              disabled={busy}
            >
              {busy ? "Syncing" : "Refresh"}
            </Btn>
          </div>
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
        <DataTable
          groups={realisedGroups}
          footer={{ label: "Total realised", valuePence: data.realised_total_pence }}
        />
      </div>

      {hasContingent && (
        <div className="stack-2">
          <div className="lhead">
            <h4>Upcoming vests</h4>
            <span className="hint">valued at today's price · excluded from total</span>
          </div>
          <div className="card card--flush">
            <DataTable
              groups={vestGroups}
              footer={
                data.contingent_total_pence > 0
                  ? {
                      label: "Total upcoming (est.)",
                      valuePence: data.contingent_total_pence,
                    }
                  : undefined
              }
            />
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
