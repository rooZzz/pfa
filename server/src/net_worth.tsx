import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

type RealisedLine = {
  kind: "account" | "pension" | "asset" | "property" | "mortgage";
  name: string;
  value_pence: number;
  valid_from: string;
  recorded_at: string;
  source_id: number;
  currency: string;
};

type ContingentLine = {
  grant_id: number;
  scheme_type: string;
  grant_date: string;
  total_units: number;
  vested_units: number;
  unvested_units: number;
  est_value_pence: number | null;
  price_per_unit_pence: number | null;
  basis: string;
  not_owned: true;
};

type TrendPoint = {
  date: string;
  realised_total_pence: number;
};

type NetWorthData = {
  as_of: string;
  realised: RealisedLine[];
  realised_total_pence: number;
  contingent: ContingentLine[];
  contingent_total_pence: number;
  unknown: string[];
  trend: TrendPoint[];
};

function formatGbp(pence: number): string {
  const abs = Math.abs(pence);
  const sign = pence < 0 ? "-" : "";
  return `${sign}£${(abs / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysAgo(dateStr: string): string {
  const then = new Date(dateStr);
  const now = new Date();
  const days = Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function kindLabel(kind: RealisedLine["kind"]): string {
  switch (kind) {
    case "account": return "Account";
    case "pension": return "Pension";
    case "asset": return "Asset";
    case "property": return "Property";
    case "mortgage": return "Mortgage";
  }
}

function NetWorthApp() {
  const [data, setData] = useState<NetWorthData | null>(null);
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
    }
  }, [app]);

  useEffect(() => {
    if (app) void load();
  }, [app, load]);

  if (error) return <p style={s.error}>Connection error: {error.message}</p>;
  if (!app) return <p style={s.muted}>Connecting…</p>;
  if (loading) return <p style={s.muted}>Loading net worth…</p>;

  if (errorMessage) {
    return (
      <div style={s.container}>
        <p style={s.error}>{errorMessage}</p>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={() => void load()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const hasContingent = data.contingent.length > 0;
  const hasUnknown = data.unknown.length > 0;

  return (
    <div style={s.container}>
      <div style={s.header}>
        <h2 style={s.title}>Net worth — {data.as_of}</h2>
        <button style={{ ...s.btn, ...s.btnSecondary }} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      <section>
        <h3 style={s.sectionHeading}>Realised</h3>
        <table style={s.table}>
          <tbody>
            {data.realised.map((line, i) => (
              <tr key={i}>
                <td style={s.kindCell}>{kindLabel(line.kind)}</td>
                <td style={s.nameCell}>{line.name}</td>
                <td style={{ ...s.amountCell, color: line.value_pence < 0 ? "#c0392b" : "inherit" }}>
                  {formatGbp(line.value_pence)}
                </td>
                <td style={s.staleCell} title={`recorded ${line.recorded_at}`}>
                  {daysAgo(line.valid_from)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={s.totalLabel}>Total realised</td>
              <td style={s.totalAmount}>{formatGbp(data.realised_total_pence)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </section>

      {hasContingent && (
        <section style={s.contingentSection}>
          <h3 style={s.sectionHeading}>
            Contingent — not yet owned
          </h3>
          <p style={s.contingentNote}>
            Unvested equity. Not included in realised total.
          </p>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Scheme</th>
                <th style={s.th}>Grant date</th>
                <th style={s.th}>Unvested units</th>
                <th style={s.th}>Est. value</th>
                <th style={s.th}>Basis</th>
              </tr>
            </thead>
            <tbody>
              {data.contingent.map((line, i) => (
                <tr key={i}>
                  <td style={s.nameCell}>{line.scheme_type.toUpperCase()}</td>
                  <td style={s.nameCell}>{line.grant_date}</td>
                  <td style={s.amountCell}>{line.unvested_units.toLocaleString()}</td>
                  <td style={s.amountCell}>
                    {line.est_value_pence != null ? formatGbp(line.est_value_pence) : "unknown"}
                  </td>
                  <td style={s.staleCell}>{line.basis}</td>
                </tr>
              ))}
            </tbody>
            {data.contingent_total_pence > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3} style={s.totalLabel}>Total contingent (est.)</td>
                  <td style={s.totalAmount}>{formatGbp(data.contingent_total_pence)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </section>
      )}

      {hasUnknown && (
        <section style={s.unknownSection}>
          <h3 style={s.sectionHeading}>No observations at this date</h3>
          <ul style={s.unknownList}>
            {data.unknown.map((u, i) => (
              <li key={i} style={s.unknownItem}>{u}</li>
            ))}
          </ul>
        </section>
      )}

      <section style={s.trendSection}>
        <h3 style={s.sectionHeading}>Monthly trend — realised</h3>
        <table style={s.table}>
          <tbody>
            {data.trend.map((pt, i) => (
              <tr key={i}>
                <td style={s.nameCell}>{pt.date}</td>
                <td style={s.amountCell}>{formatGbp(pt.realised_total_pence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: { fontFamily: "system-ui", padding: "1rem", maxWidth: "40rem", fontSize: "0.875rem" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" },
  title: { margin: 0, fontSize: "1rem" },
  sectionHeading: { fontSize: "0.75rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#666", margin: "1.25rem 0 0.5rem" },
  table: { borderCollapse: "collapse", width: "100%" },
  kindCell: { padding: "0.25rem 0.5rem 0.25rem 0", color: "#888", fontSize: "0.75rem", whiteSpace: "nowrap", width: "5rem" },
  nameCell: { padding: "0.25rem 0.75rem 0.25rem 0", color: "#333" },
  amountCell: { padding: "0.25rem 0", fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" },
  staleCell: { padding: "0.25rem 0 0.25rem 0.75rem", color: "#aaa", fontSize: "0.75rem", whiteSpace: "nowrap" },
  totalLabel: { padding: "0.5rem 0 0.25rem", fontWeight: 600, color: "#333" },
  totalAmount: { padding: "0.5rem 0 0.25rem", fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right" },
  th: { padding: "0.25rem 0.5rem 0.25rem 0", textAlign: "left", fontWeight: 500, color: "#666", fontSize: "0.75rem" },
  contingentSection: { borderLeft: "3px solid #e67e22", paddingLeft: "0.75rem", marginTop: "1rem" },
  contingentNote: { color: "#888", fontSize: "0.75rem", margin: "0 0 0.5rem" },
  unknownSection: { marginTop: "1rem", color: "#888" },
  unknownList: { margin: "0.25rem 0", paddingLeft: "1.25rem" },
  unknownItem: { marginBottom: "0.2rem", fontSize: "0.8rem" },
  trendSection: { marginTop: "1rem" },
  btn: { padding: "0.3rem 0.75rem", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" },
  btnPrimary: { background: "#0070f3", color: "#fff" },
  btnSecondary: { background: "#f0f0f0", color: "#333" },
  muted: { color: "#888", fontFamily: "system-ui", padding: "1rem", fontSize: "0.875rem" },
  error: { color: "#c0392b", fontFamily: "system-ui", padding: "1rem", fontSize: "0.875rem" },
};

createRoot(document.getElementById("root")!).render(<NetWorthApp />);
