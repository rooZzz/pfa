import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CashflowResult, IncomeTotal } from "../cashflow/types.js";
import { Btn, Meter, MiniBars, Stat } from "./components.js";
import { formatGbp, formatGbpk } from "./format.js";

type CashflowData = CashflowResult;

function categoryLabel(cat: string): string {
  if (cat === "income") return "Income (other)";
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

function SalaryBar({ income }: { income: IncomeTotal }) {
  const segments = [
    { cls: "seg-net", value: income.net_pence },
    { cls: "seg-paye", value: income.paye_pence },
    { cls: "seg-ni", value: income.ni_employee_pence },
    { cls: "seg-pension", value: income.pension_employee_pence },
  ];
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  return (
    <div className="segbar">
      {segments.map((s, i) => (
        <span
          key={i}
          className={s.cls}
          style={{ width: (s.value / total) * 100 + "%" }}
        />
      ))}
    </div>
  );
}

function KV({ k, v, tone }: { k: string; v: string; tone?: "pos" | "neg" }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={"v" + (tone ? " " + tone : "")}>{v}</span>
    </div>
  );
}

function CashflowApp() {
  const [data, setData] = useState<CashflowData | null>(null);
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
        const result = await app.callServerTool({
          name: "get_cashflow",
          arguments: {},
        });
        const text = result.content?.find((c: { type: string }) => c.type === "text") as
          | { type: "text"; text: string }
          | undefined;
        if (!text) throw new Error("No response from get_cashflow.");
        try {
          setData(JSON.parse(text.text) as CashflowData);
        } catch {
          throw new Error(text.text);
        }
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

  const hasIncome = data.income.payslip_count > 0;
  const isSavings = (cat: string) => cat === "savings";
  const outflowCategories = data.transactions_by_category
    .filter((l) => l.outflow_pence > 0 && !isSavings(l.category))
    .sort((a, b) => b.outflow_pence - a.outflow_pence);
  const spendMax = Math.max(1, ...outflowCategories.map((l) => l.outflow_pence));

  const inflowCategories = data.transactions_by_category
    .filter((l) => l.inflow_pence > 0 && l.outflow_pence === 0 && !isSavings(l.category))
    .sort((a, b) => b.inflow_pence - a.inflow_pence);
  const inflowMax = Math.max(1, ...inflowCategories.map((l) => l.inflow_pence));

  const savingsLines = data.transactions_by_category.filter((l) => isSavings(l.category));
  const savingsOut = savingsLines.reduce((sum, l) => sum + l.outflow_pence, 0);
  const savingsIn = savingsLines.reduce((sum, l) => sum + l.inflow_pence, 0);
  const hasSavings = data.pot_savings_net_pence !== 0 || savingsOut > 0 || savingsIn > 0;

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
      <div className="screen-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="screen-title">Cashflow</div>
          <div className="screen-sub">
            {data.tax_year} · {data.period_start} – {data.period_end}
          </div>
        </div>
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

      <div>
        <div className="figure-hero">
          {(netPos ? "+" : "") + formatGbp(data.net_cashflow_pence, { whole: true })}
        </div>
        <div className={"stat-delta mt-2 " + (netPos ? "pos" : "neg")}>
          {netPos ? "surplus" : "deficit"} · tax year to date
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card card-sunken">
          <Stat
            label="Spending"
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
          <table className="t compact mt-4">
            <thead>
              <tr>
                <th>Month</th>
                <th className="col-num">In</th>
                <th className="col-num">Out</th>
                <th className="col-num">Net</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((t, i) => (
                <tr key={i}>
                  <td>{monthLabel(t.month)}</td>
                  <td className="col-num pos">{formatGbp(t.transaction_inflow_pence)}</td>
                  <td className="col-num neg">
                    {"−" + formatGbp(t.transaction_outflow_pence)}
                  </td>
                  <td className={"col-num " + (t.net_pence >= 0 ? "pos" : "neg")}>
                    {formatGbp(t.net_pence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {outflowCategories.length > 0 && (
        <div className="card">
          <div className="card-label mb-3">
            Spending by category · {formatGbp(data.spending_total_pence)}
          </div>
          <div className="stack-3">
            {outflowCategories.map((line, i) => (
              <Meter
                key={i}
                name={labelFor(line.category)}
                sub={subFor(line)}
                value={formatGbp(line.outflow_pence)}
                pct={(line.outflow_pence / spendMax) * 100}
                tone="neg"
              />
            ))}
          </div>
        </div>
      )}

      {inflowCategories.length > 0 && (
        <div className="card">
          <div className="card-label mb-3">
            Other inflows · {formatGbp(data.income_total_pence)}
          </div>
          <div className="stack-3">
            {inflowCategories.map((line, i) => (
              <Meter
                key={i}
                name={labelFor(line.category)}
                sub={subFor(line)}
                value={formatGbp(line.inflow_pence)}
                pct={(line.inflow_pence / inflowMax) * 100}
                tone="pos"
              />
            ))}
          </div>
        </div>
      )}

      {hasSavings && (
        <div className="card">
          <div className="card-label mb-3">Savings &amp; investing</div>
          <div className="stack-3">
            {data.pot_savings_net_pence !== 0 && (
              <KV
                k="Into Monzo pots (stays liquid)"
                v={formatGbp(data.pot_savings_net_pence)}
              />
            )}
            {savingsOut > 0 && (
              <KV
                k="To external savings / investments"
                v={"−" + formatGbp(savingsOut)}
                tone="neg"
              />
            )}
            {savingsIn > 0 && (
              <KV k="Back from external savings" v={formatGbp(savingsIn)} tone="pos" />
            )}
          </div>
          <div className="note mt-3">
            Pot transfers stay in liquid savings; only money leaving Monzo affects net
            cashflow.
          </div>
        </div>
      )}

      {hasIncome && (
        <div className="card">
          <div className="card-label mb-3">
            Salary · tax decomposition · {data.income.payslip_count} payslip
            {data.income.payslip_count === 1 ? "" : "s"}
          </div>
          <div className="stack-3">
            <SalaryBar income={data.income} />
            <div className="grid cols-2" style={{ gap: "var(--space-2) var(--space-4)" }}>
              <KV k="Gross" v={formatGbp(data.income.gross_pence)} />
              <KV k="Net" v={formatGbp(data.income.net_pence)} tone="pos" />
              <KV k="PAYE" v={"−" + formatGbp(data.income.paye_pence)} tone="neg" />
              <KV k="NI" v={"−" + formatGbp(data.income.ni_employee_pence)} tone="neg" />
              <KV
                k="Pension (you)"
                v={"−" + formatGbp(data.income.pension_employee_pence)}
                tone="neg"
              />
              <KV
                k="Pension (employer)"
                v={formatGbp(data.income.pension_employer_pence)}
              />
            </div>
            <div className="note">
              Take-home is counted once via the bank feed. This is the gross, tax, and
              pension split only.
            </div>
          </div>
        </div>
      )}

      {!hasIncome && (
        <div className="note">
          No payslips recorded in this period. Upload a payslip to add the salary tax
          breakdown.
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<CashflowApp />);
