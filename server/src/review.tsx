import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { ParsedPayslip } from "../tools/ingest_document.js";

type Status = "waiting" | "pending" | "confirming" | "confirmed" | "error";

function formatGbp(pence: number | null | undefined): string {
  if (pence == null) return "not shown";
  return `£${(pence / 100).toFixed(2)}`;
}

function ReviewApp() {
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [sourceFile, setSourceFile] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedPayslip | null>(null);
  const [status, setStatus] = useState<Status>("waiting");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        const text = result.content?.find((c) => c.type === "text")?.text;
        if (!text) return;
        try {
          const data = JSON.parse(text) as {
            review_id: string;
            source_file: string;
            parsed: ParsedPayslip;
          };
          setReviewId(data.review_id);
          setSourceFile(data.source_file);
          setParsed(data.parsed);
          setStatus("pending");
        } catch {
          setStatus("error");
          setErrorMessage("Failed to parse payslip extraction result.");
        }
      };
    },
  });

  async function handleConfirm() {
    if (!app || !reviewId) return;
    setStatus("confirming");
    try {
      const result = await app.callServerTool({
        name: "confirm_staged_rows",
        arguments: { review_id: reviewId },
      });
      const text = result.content?.find((c) => c.type === "text")?.text ?? "";
      setConfirmMessage(text);
      setStatus("confirmed");
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "Confirmation failed.",
      );
    }
  }

  function handleCancel() {
    setStatus("error");
    setErrorMessage("Review cancelled. No data was written.");
  }

  if (error) {
    return <p style={styles.error}>Connection error: {error.message}</p>;
  }

  if (!app || status === "waiting") {
    return <p style={styles.muted}>Waiting for payslip extraction…</p>;
  }

  if (status === "confirmed") {
    return (
      <div style={styles.container}>
        <p style={styles.success}>{confirmMessage}</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div style={styles.container}>
        <p style={styles.error}>{errorMessage}</p>
      </div>
    );
  }

  if (!parsed) {
    return <p style={styles.muted}>Loading…</p>;
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Review payslip</h2>
      {sourceFile && <p style={styles.source}>Source: {sourceFile}</p>}

      <table style={styles.table}>
        <tbody>
          <Row label="Pay date" value={parsed.pay_date} />
          <Row label="Tax year" value={parsed.tax_year ?? "not shown"} />
          <Row label="Gross pay" value={formatGbp(parsed.gross_pence)} />
          {parsed.taxable_pence != null && (
            <Row label="Taxable pay" value={formatGbp(parsed.taxable_pence)} />
          )}
          <Row label="Net pay" value={formatGbp(parsed.net_pence)} />
          <Row label="PAYE" value={formatGbp(parsed.paye_pence)} />
          <Row label="NI (employee)" value={formatGbp(parsed.ni_employee_pence)} />
          <Row label="Pension (employee)" value={formatGbp(parsed.pension_employee_pence)} />
          <Row label="Pension (employer)" value={formatGbp(parsed.pension_employer_pence)} />
        </tbody>
      </table>

      <div style={styles.actions}>
        <button
          style={{ ...styles.button, ...styles.confirm }}
          onClick={handleConfirm}
          disabled={status === "confirming"}
        >
          {status === "confirming" ? "Saving…" : "Confirm"}
        </button>
        <button
          style={{ ...styles.button, ...styles.cancel }}
          onClick={handleCancel}
          disabled={status === "confirming"}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={styles.label}>{label}</td>
      <td style={styles.value}>{value}</td>
    </tr>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { fontFamily: "system-ui", padding: "1rem", maxWidth: "28rem" },
  heading: { marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" },
  source: { fontSize: "0.75rem", color: "#888", marginBottom: "1rem" },
  table: { borderCollapse: "collapse", width: "100%", marginBottom: "1.25rem" },
  label: { padding: "0.3rem 0.75rem 0.3rem 0", color: "#666", whiteSpace: "nowrap" },
  value: { padding: "0.3rem 0", fontVariantNumeric: "tabular-nums" },
  actions: { display: "flex", gap: "0.5rem" },
  button: { padding: "0.4rem 1rem", border: "none", borderRadius: "4px", cursor: "pointer", fontSize: "0.875rem" },
  confirm: { background: "#0070f3", color: "#fff" },
  cancel: { background: "#eee", color: "#333" },
  success: { color: "#0a7a0a" },
  error: { color: "#c0392b" },
  muted: { color: "#888", fontFamily: "system-ui", padding: "1rem" },
};

createRoot(document.getElementById("root")!).render(<ReviewApp />);
