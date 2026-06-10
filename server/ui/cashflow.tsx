import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { CashflowResult, IncomeTotal } from "../cashflow/types.js";
import type { ClassOutcome } from "../core/freshness.js";
import { Masthead } from "./branding.js";
import {
  Btn,
  CompositionBar,
  CoverageGrid,
  EmptyState,
  MiniBars,
  Stat,
} from "./components.js";
import { DataTable } from "./data_table.js";
import type { DataGroup } from "./data_table.js";
import { formatGbp, formatGbpk } from "./format.js";

type CashflowData = CashflowResult;

function categoryLabel(cat: string): string {
  if (cat === "income") return "Income (other)";
  if (cat === "savings") return "Savings & investing";
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isCustomCategory(cat: string): boolean {
  return cat.startsWith("category_");
}

function monthLabel(ym: string): string {
  const parts = ym.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  if (!year || !month) return ym;
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-GB", {
    month: "short",
  });
}

function EarningsWaterfall({ income }: { income: IncomeTotal }) {
  const rows = [
    { label: "PAYE", value: income.paye_pence, tone: "neg" as const },
    { label: "NI", value: income.ni_employee_pence, tone: "neg" as const },
    ...(income.other_deductions_pence > 0
      ? [
          {
            label: "Other deductions",
            value: income.other_deductions_pence,
            tone: "neg" as const,
          },
        ]
      : []),
    { label: "Net pay", value: income.net_pence, tone: "pos" as const },
  ];
  return <CompositionBar rows={rows} variant="tone" />;
}

function PayslipBreakdown({ income }: { income: IncomeTotal }) {
  if (income.line_items.length === 0) return null;
  const sectionTotal = (section: "payment" | "deduction") =>
    income.line_items
      .filter((item) => item.section === section)
      .reduce((sum, item) => sum + item.amount_pence, 0);
  const toRows = (section: "payment" | "deduction") =>
    income.line_items
      .filter((item) => item.section === section)
      .map((item) => ({
        key: `${section}-${item.description}`,
        label: item.description,
        valuePence: item.amount_pence,
      }));
  const groups: DataGroup[] = [
    {
      key: "payments",
      label: "Payments",
      rows: toRows("payment"),
      subtotalPence: sectionTotal("payment"),
      truncate: 5,
      sortByValue: true,
    },
    {
      key: "deductions",
      label: "Deductions",
      rows: toRows("deduction"),
      subtotalPence: sectionTotal("deduction"),
      truncate: 5,
      sortByValue: true,
    },
  ];
  return <DataTable groups={groups} />;
}

function KV({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={"v" + (tone ? " " + tone : "")}>{v}</span>
    </div>
  );
}

const outdatedBadge = (
  <span className="badge warn ml-2">
    <span className="led" />
    outdated
  </span>
);

function MonzoStatus({
  refreshing,
  failed,
}: {
  refreshing: boolean;
  failed: boolean;
}): ReactNode {
  if (!refreshing && !failed) return null;
  return (
    <>
      {refreshing && <span className="spinner ml-2" />}
      {failed && outdatedBadge}
    </>
  );
}

function CashflowApp() {
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
  });

  const fetchData = useCallback(async (): Promise<CashflowData | null> => {
    if (!app) return null;
    const result = await app.callServerTool({
      name: "get_cashflow",
      arguments: { auto_refresh: false },
    });
    const text = result.content?.find((c: { type: string }) => c.type === "text") as
      | { type: "text"; text: string }
      | undefined;
    if (!text) throw new Error("No response from get_cashflow.");
    let parsed: CashflowData;
    try {
      parsed = JSON.parse(text.text) as CashflowData;
    } catch {
      throw new Error(text.text);
    }
    setData(parsed);
    return parsed;
  }, [app]);

  const runRefresh = useCallback(async () => {
    if (!app) return;
    setFailed(false);
    setRefreshing(true);
    try {
      const result = await app.callServerTool({
        name: "refresh_stale_data",
        arguments: { classes: ["monzo"] },
      });
      const text = result.content?.find((c: { type: string }) => c.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      const outcomes = text ? (JSON.parse(text.text) as ClassOutcome[]) : [];
      await fetchData();
      setFailed(outcomes.some((o) => o.class === "monzo" && o.action === "failed"));
    } catch {
      setFailed(true);
    } finally {
      setRefreshing(false);
    }
  }, [app, fetchData]);

  const load = useCallback(async () => {
    if (!app) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const parsed = await fetchData();
      const stale = parsed?.freshness.some((f) => f.connected && f.is_stale) ?? false;
      if (stale) void runRefresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [app, fetchData, runRefresh]);

  const manualRefresh = useCallback(async () => {
    if (!app) return;
    setBusy(true);
    setErrorMessage(null);
    setFailed(false);
    try {
      const parsed = await fetchData();
      const connected = parsed?.freshness.some((f) => f.connected) ?? false;
      if (connected) await runRefresh();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setBusy(false);
    }
  }, [app, fetchData, runRefresh]);

  useEffect(() => {
    if (app) void load();
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
          {app ? "Loading cashflow" : "Connecting"}
        </div>
      </div>
    );
  }
  if (errorMessage) {
    return (
      <div className="screen rise stack">
        <p className="note">{errorMessage}</p>
        <div>
          <Btn variant="secondary" size="sm" icon="refresh" onClick={() => void load()}>
            Retry
          </Btn>
        </div>
      </div>
    );
  }
  if (!data) return null;

  const hasIncome = data.income.payslip_count > 0;
  const outflowCategories = data.transactions_by_category
    .filter((l) => l.outflow_pence > 0)
    .sort((a, b) => b.outflow_pence - a.outflow_pence);
  const spendMax = Math.max(1, ...outflowCategories.map((l) => l.outflow_pence));

  const incomeSources = data.income_by_source;
  const incomeMax = Math.max(1, ...incomeSources.map((l) => l.inflow_pence));

  const customNumber = new Map<string, number>();
  for (const line of data.transactions_by_category) {
    if (isCustomCategory(line.category)) {
      customNumber.set(line.category, customNumber.size + 1);
    }
  }
  const labelFor = (cat: string): string => {
    const n = customNumber.get(cat);
    return n ? `Custom ${n}` : categoryLabel(cat);
  };
  const subFor = (line: { category: string; samples: string[] }): string | undefined =>
    isCustomCategory(line.category) && line.samples.length > 0
      ? line.samples.join(" · ")
      : undefined;

  const netPos = data.net_cashflow_pence >= 0;

  const trendRows = data.trend.map((t) => ({
    label: monthLabel(t.month),
    in: t.transaction_inflow_pence,
    out: t.transaction_outflow_pence,
  }));

  return (
    <div className="screen rise stack">
      <Masthead
        tight
        title="Cashflow"
        sub={`${data.tax_year} · ${data.period_start} – ${data.period_end}`}
        action={
          <div className="screen-actions">
            {data.coverage.length > 0 && <CoverageGrid months={data.coverage} />}
            <Btn
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => void manualRefresh()}
              disabled={busy}
            >
              {busy ? "Refreshing" : "Refresh"}
            </Btn>
          </div>
        }
      />

      <div>
        <div className="figure-hero">
          {(netPos ? "+" : "") + formatGbp(data.net_cashflow_pence, { whole: true })}
          <MonzoStatus refreshing={refreshing} failed={failed} />
        </div>
        <div className={"stat-delta mt-2 " + (netPos ? "pos" : "neg")}>
          {netPos ? "surplus" : "deficit"} · tax year to date
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card card-sunken">
          <Stat
            label="Money out"
            value={formatGbpk(data.spending_total_pence)}
            delta="this year"
          />
        </div>
        <div className="card card-sunken">
          <Stat
            label="Into savings"
            value={formatGbpk(data.pot_savings_net_pence)}
            delta="pots · liquid"
            deltaTone={data.pot_savings_net_pence >= 0 ? "pos" : "neg"}
          />
        </div>
      </div>

      {trendRows.length > 0 && (
        <div className="card">
          <div className="row row-2 mb-4">
            <span className="card-label" style={{ whiteSpace: "nowrap" }}>
              Monthly in / out
            </span>
            <span className="legend">
              <span className="key pos">in</span>
              <span className="key neg">out</span>
            </span>
          </div>
          <MiniBars rows={trendRows} height={72} />
          <div className="mt-4">
            <DataTable
              inset={false}
              labelHeader="Month"
              columns={[
                { key: "in", header: "In", align: "num" },
                { key: "out", header: "Out", align: "num" },
                { key: "net", header: "Net", align: "num" },
              ]}
              groups={[
                {
                  key: "trend",
                  rows: data.trend.map((t) => ({
                    key: t.month,
                    label: monthLabel(t.month),
                    cells: [
                      { valuePence: t.transaction_inflow_pence, tone: "pos" },
                      {
                        valuePence: t.transaction_outflow_pence,
                        display: "−" + formatGbp(t.transaction_outflow_pence),
                        tone: "neg",
                      },
                      { valuePence: t.net_pence, tone: t.net_pence >= 0 ? "pos" : "neg" },
                    ],
                  })),
                },
              ]}
            />
          </div>
        </div>
      )}

      {outflowCategories.length > 0 && (
        <div className="card">
          <div className="card-label mb-3">
            Money out by category · {formatGbp(data.spending_total_pence)}
            <MonzoStatus refreshing={refreshing} failed={failed} />
          </div>
          <DataTable
            variant="bars"
            groups={[
              {
                key: "spend",
                truncate: 5,
                sortByValue: true,
                rows: outflowCategories.map((line) => ({
                  key: line.category,
                  label: labelFor(line.category),
                  sub: subFor(line),
                  valuePence: line.outflow_pence,
                  bar: { pct: (line.outflow_pence / spendMax) * 100, tone: "neg" },
                })),
              },
            ]}
          />
        </div>
      )}

      {incomeSources.length > 0 && (
        <div className="card">
          <div className="card-label mb-3">
            Money in by source · {formatGbp(data.income_total_pence)}
            <MonzoStatus refreshing={refreshing} failed={failed} />
          </div>
          <DataTable
            variant="bars"
            groups={[
              {
                key: "income",
                truncate: 5,
                sortByValue: true,
                rows: incomeSources.map((line) => ({
                  key: line.source,
                  label: line.source,
                  valuePence: line.inflow_pence,
                  bar: { pct: (line.inflow_pence / incomeMax) * 100, tone: "pos" },
                })),
              },
            ]}
          />
        </div>
      )}

      {hasIncome && (
        <div className="card">
          <div className="row-between mb-3">
            <span className="card-label">
              Salary · gross to net · {data.income.payslip_count} payslip
              {data.income.payslip_count === 1 ? "" : "s"}
            </span>
            {data.income.tax_code && (
              <span className="value-chip">{data.income.tax_code}</span>
            )}
          </div>
          <div className="stack-3">
            <EarningsWaterfall income={data.income} />
            <div className="grid cols-2" style={{ gap: "var(--space-2) var(--space-4)" }}>
              <KV k="Gross" v={formatGbp(data.income.gross_pence)} />
              <KV k="Net pay" v={formatGbp(data.income.net_pence)} tone="pos" />
              {data.income.pension_employer_pence > 0 && (
                <>
                  <KV
                    k="Employer pension"
                    v={formatGbp(data.income.pension_employer_pence)}
                  />
                  <KV
                    k="Total reward"
                    v={formatGbp(
                      data.income.gross_pence + data.income.pension_employer_pence,
                    )}
                  />
                </>
              )}
            </div>
            <PayslipBreakdown income={data.income} />
          </div>
        </div>
      )}

      {!hasIncome && <EmptyState icon="file">No payslips this period.</EmptyState>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<CashflowApp />);
