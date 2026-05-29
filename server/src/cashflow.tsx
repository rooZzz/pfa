import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CashflowResult } from "../cashflow/types.js";

type CashflowData = CashflowResult;

function formatGbp(pence: number): string {
  const abs = Math.abs(pence);
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(abs / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function categoryLabel(cat: string): string {
  const labels: Record<string, string> = {
    income: "Income (other)",
    mondo: "Monzo top-up",
  };
  if (labels[cat]) return labels[cat];
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function CashflowApp() {
  const [data, setData] = useState<CashflowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
  });

  const load = useCallback(async () => {
    if (!app) return;
    setLoading(true);
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
      let parsed: CashflowData;
      try {
        parsed = JSON.parse(text.text) as CashflowData;
      } catch {
        throw new Error(text.text);
      }
      setData(parsed);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [app]);

  useEffect(() => {
    if (app) void load();
  }, [app, load]);

  if (error) return <p style={s.error}>Connection error: {error.message}</p>;
  if (!app) return <p style={s.muted}>Connecting…</p>;
  if (loading) return <p style={s.muted}>Loading cashflow…</p>;

  if (errorMessage) {
    return (
      <div style={s.container}>
        <p style={s.error}>{errorMessage}</p>
        <button style={{ ...s.btn, ...s.btnSecondary }} onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const hasTransactions = data.transactions_by_category.length > 0;
  const hasIncome = data.income.payslip_count > 0;

  const isSavings = (cat: string) => cat === "savings";
  const outflowCategories = data.transactions_by_category.filter(
    (l) => l.outflow_pence > 0 && !isSavings(l.category),
  );
  const inflowCategories = data.transactions_by_category.filter(
    (l) => l.inflow_pence > 0 && l.outflow_pence === 0 && !isSavings(l.category),
  );
  const savingsLines = data.transactions_by_category.filter((l) => isSavings(l.category));
  const savingsOut = savingsLines.reduce((sum, l) => sum + l.outflow_pence, 0);
  const savingsIn = savingsLines.reduce((sum, l) => sum + l.inflow_pence, 0);

  const customNumber = new Map<string, number>();
  for (const line of data.transactions_by_category) {
    if (line.category.startsWith("category_")) {
      customNumber.set(line.category, customNumber.size + 1);
    }
  }
  const labelFor = (cat: string): string => {
    const n = customNumber.get(cat);
    return n ? `Custom ${n}` : categoryLabel(cat);
  };

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h2 style={s.title}>
          Cashflow — {data.tax_year} ({data.period_start} to {data.period_end})
        </h2>
        <button style={{ ...s.btn, ...s.btnSecondary }} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <section>
        <h3 style={s.sectionHeading}>Net cashflow — tax year to date</h3>
        <div
          style={{
            ...s.netTotal,
            color: data.net_cashflow_pence >= 0 ? "#27ae60" : "#c0392b",
          }}
        >
          {formatGbp(data.net_cashflow_pence)}
        </div>
      </section>

      {hasIncome && (
        <section>
          <h3 style={s.sectionHeading}>
            Salary tax breakdown — {data.income.payslip_count} payslip
            {data.income.payslip_count !== 1 ? "s" : ""}
          </h3>
          <p style={s.emptyNote}>
            From payslips. Take-home is already counted in inflows below — shown here only
            for the gross/tax/pension split.
          </p>
          <table style={s.table}>
            <tbody>
              <tr>
                <td style={s.nameCell}>Net pay (take-home)</td>
                <td style={s.amountCell}>{formatGbp(data.income.net_pence)}</td>
              </tr>
              <tr style={s.deductionRow}>
                <td style={s.nameCell}>Gross pay</td>
                <td style={s.amountCell}>{formatGbp(data.income.gross_pence)}</td>
              </tr>
              <tr style={s.deductionRow}>
                <td style={{ ...s.nameCell, ...s.indent }}>PAYE</td>
                <td style={{ ...s.amountCell, color: "#c0392b" }}>
                  -{formatGbp(data.income.paye_pence)}
                </td>
              </tr>
              <tr style={s.deductionRow}>
                <td style={{ ...s.nameCell, ...s.indent }}>NI (employee)</td>
                <td style={{ ...s.amountCell, color: "#c0392b" }}>
                  -{formatGbp(data.income.ni_employee_pence)}
                </td>
              </tr>
              <tr style={s.deductionRow}>
                <td style={{ ...s.nameCell, ...s.indent }}>Pension (employee)</td>
                <td style={{ ...s.amountCell, color: "#c0392b" }}>
                  -{formatGbp(data.income.pension_employee_pence)}
                </td>
              </tr>
              {data.income.pension_employer_pence > 0 && (
                <tr style={s.deductionRow}>
                  <td style={{ ...s.nameCell, ...s.indent }}>Pension (employer)</td>
                  <td style={s.amountCell}>
                    {formatGbp(data.income.pension_employer_pence)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {!hasIncome && (
        <section>
          <h3 style={s.sectionHeading}>Income</h3>
          <p style={s.emptyNote}>
            No payslips recorded in this period. Upload a payslip to add income.
          </p>
        </section>
      )}

      {hasTransactions && outflowCategories.length > 0 && (
        <section>
          <h3 style={s.sectionHeading}>
            Spending — {formatGbp(data.spending_total_pence)}
          </h3>
          <table style={s.table}>
            <tbody>
              {outflowCategories.map((line, i) => (
                <tr key={i}>
                  <td style={s.nameCell}>
                    {labelFor(line.category)}
                    {customNumber.has(line.category) && line.samples.length > 0 && (
                      <div style={s.samples}>{line.samples.join(" · ")}</div>
                    )}
                  </td>
                  <td style={{ ...s.amountCell, color: "#c0392b" }}>
                    -{formatGbp(line.outflow_pence)}
                  </td>
                  <td style={s.countCell}>{line.count}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {inflowCategories.length > 0 && (
        <section>
          <h3 style={s.sectionHeading}>
            Other inflows — {formatGbp(data.income_total_pence)}
          </h3>
          <table style={s.table}>
            <tbody>
              {inflowCategories.map((line, i) => (
                <tr key={i}>
                  <td style={s.nameCell}>
                    {labelFor(line.category)}
                    {customNumber.has(line.category) && line.samples.length > 0 && (
                      <div style={s.samples}>{line.samples.join(" · ")}</div>
                    )}
                  </td>
                  <td style={{ ...s.amountCell, color: "#27ae60" }}>
                    {formatGbp(line.inflow_pence)}
                  </td>
                  <td style={s.countCell}>{line.count}×</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(savingsLines.length > 0 || data.pot_savings_net_pence !== 0) && (
        <section>
          <h3 style={s.sectionHeading}>Savings & investing</h3>
          <p style={s.emptyNote}>
            Money set aside this period. Pot transfers stay in your liquid savings; only
            money leaving Monzo affects net cashflow.
          </p>
          <table style={s.table}>
            <tbody>
              {data.pot_savings_net_pence !== 0 && (
                <tr>
                  <td style={s.nameCell}>Into Monzo pots (stays liquid)</td>
                  <td style={s.amountCell}>{formatGbp(data.pot_savings_net_pence)}</td>
                </tr>
              )}
              {savingsOut > 0 && (
                <tr>
                  <td style={s.nameCell}>To external savings / investments</td>
                  <td style={{ ...s.amountCell, color: "#c0392b" }}>
                    -{formatGbp(savingsOut)}
                  </td>
                </tr>
              )}
              {savingsIn > 0 && (
                <tr>
                  <td style={s.nameCell}>Back from external savings</td>
                  <td style={{ ...s.amountCell, color: "#27ae60" }}>
                    {formatGbp(savingsIn)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      {!hasTransactions && (
        <section>
          <h3 style={s.sectionHeading}>Transactions</h3>
          <p style={s.emptyNote}>
            No transactions recorded in this period. Use record_transaction to add
            spending.
          </p>
        </section>
      )}

      {data.trend.length > 0 && (
        <section style={s.trendSection}>
          <h3 style={s.sectionHeading}>Monthly trend</h3>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Month</th>
                <th style={{ ...s.th, textAlign: "right" }}>In</th>
                <th style={{ ...s.th, textAlign: "right" }}>Out</th>
                <th style={{ ...s.th, textAlign: "right" }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {data.trend.map((pt, i) => (
                <tr key={i}>
                  <td style={s.nameCell}>{pt.month}</td>
                  <td style={{ ...s.amountCell, color: "#27ae60" }}>
                    {formatGbp(pt.transaction_inflow_pence)}
                  </td>
                  <td style={{ ...s.amountCell, color: "#c0392b" }}>
                    -{formatGbp(pt.transaction_outflow_pence)}
                  </td>
                  <td
                    style={{
                      ...s.amountCell,
                      fontWeight: 600,
                      color: pt.net_pence >= 0 ? "#27ae60" : "#c0392b",
                    }}
                  >
                    {formatGbp(pt.net_pence)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    fontFamily: "system-ui",
    padding: "1rem",
    maxWidth: "40rem",
    fontSize: "0.875rem",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "1rem",
  },
  title: { margin: 0, fontSize: "1rem" },
  sectionHeading: {
    fontSize: "0.75rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "#666",
    margin: "1.25rem 0 0.5rem",
  },
  netTotal: {
    fontSize: "1.5rem",
    fontVariantNumeric: "tabular-nums",
    fontWeight: 700,
    margin: "0.25rem 0",
  },
  table: { borderCollapse: "collapse", width: "100%" },
  nameCell: { padding: "0.25rem 0.75rem 0.25rem 0", color: "#333" },
  amountCell: {
    padding: "0.25rem 0",
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  countCell: {
    padding: "0.25rem 0 0.25rem 0.75rem",
    color: "#aaa",
    fontSize: "0.75rem",
    whiteSpace: "nowrap",
    textAlign: "right",
  },
  th: {
    padding: "0.25rem 0.5rem 0.25rem 0",
    textAlign: "left",
    fontWeight: 500,
    color: "#666",
    fontSize: "0.75rem",
  },
  samples: { fontSize: "0.7rem", color: "#aaa", marginTop: "0.1rem" },
  deductionRow: { color: "#777" },
  indent: { paddingLeft: "1rem" },
  trendSection: { marginTop: "1rem" },
  emptyNote: { color: "#aaa", fontSize: "0.8rem", margin: "0.25rem 0" },
  btn: {
    padding: "0.3rem 0.75rem",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.8rem",
  },
  btnSecondary: { background: "#f0f0f0", color: "#333" },
  muted: {
    color: "#888",
    fontFamily: "system-ui",
    padding: "1rem",
    fontSize: "0.875rem",
  },
  error: {
    color: "#c0392b",
    fontFamily: "system-ui",
    padding: "1rem",
    fontSize: "0.875rem",
  },
};

createRoot(document.getElementById("root")!).render(<CashflowApp />);
