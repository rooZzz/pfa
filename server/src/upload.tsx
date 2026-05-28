import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IngestReviewResult } from "../tools/ingest_document.js";

type IngestResult = IngestReviewResult;

type Status = "drop" | "parsing" | "review" | "confirming" | "confirmed" | "error";

function formatGbp(pence: number | null | undefined): string {
  if (pence == null) return "not shown";
  return `£${(pence / 100).toFixed(2)}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={styles.label}>{label}</td>
      <td style={styles.value}>{value}</td>
    </tr>
  );
}

function UploadApp() {
  const [status, setStatus] = useState<Status>("drop");
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { app, error } = useApp({
    appInfo: { name: "pfa", version: "0.1.0" },
    capabilities: {},
  });

  const processFile = useCallback(
    (file: File) => {
      if (!app) return;
      setStatus("parsing");

      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const dataUrl = e.target?.result as string;
          const base64 = dataUrl.split(",")[1];

          const result = await app.callServerTool({
            name: "ingest_document",
            arguments: {
              file_base64: base64,
              filename: file.name,
              mime_type: file.type || "application/pdf",
              document_type: "payslip",
            },
          });

          const text = result.content?.find(
            (c: { type: string }) => c.type === "text",
          ) as { type: "text"; text: string } | undefined;
          if (!text) throw new Error("No response from ingest_document.");

          const data = JSON.parse(text.text) as IngestResult;
          setIngestResult(data);
          setStatus("review");
        } catch (err) {
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : "Parsing failed.");
        }
      };
      reader.onerror = () => {
        setStatus("error");
        setErrorMessage("Failed to read file.");
      };
      reader.readAsDataURL(file);
    },
    [app],
  );

  async function handleConfirm() {
    if (!app || !ingestResult) return;
    setStatus("confirming");
    try {
      const result = await app.callServerTool({
        name: "confirm_staged_rows",
        arguments: { review_id: ingestResult.review_id },
      });
      const text = result.content?.find((c: { type: string }) => c.type === "text") as
        | { type: "text"; text: string }
        | undefined;
      setConfirmMessage(text?.text ?? "Saved.");
      setStatus("confirmed");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Confirmation failed.");
    }
  }

  function handleCancel() {
    setStatus("drop");
    setIngestResult(null);
    setErrorMessage(null);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave() {
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  if (error) {
    return <p style={styles.error}>Connection error: {error.message}</p>;
  }

  if (!app) {
    return <p style={styles.muted}>Connecting…</p>;
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
        <button
          style={{ ...styles.button, ...styles.cancel }}
          onClick={() => {
            setStatus("drop");
            setErrorMessage(null);
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (status === "parsing") {
    return <p style={styles.muted}>Parsing payslip…</p>;
  }

  if (status === "confirming") {
    return <p style={styles.muted}>Saving…</p>;
  }

  if (status === "review" && ingestResult) {
    const { parsed, payload, filename } = ingestResult;
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Review payslip</h2>
        <p style={styles.source}>Source: {filename}</p>

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
            <Row
              label="Pension (employee)"
              value={formatGbp(parsed.pension_employee_pence)}
            />
            <Row
              label="Pension (employer)"
              value={formatGbp(parsed.pension_employer_pence)}
            />
          </tbody>
        </table>

        {payload.line_items.length > 0 && (
          <>
            <h3 style={styles.subheading}>Line items</h3>
            <table style={styles.table}>
              <tbody>
                {payload.line_items.map((item, i) => (
                  <Row
                    key={i}
                    label={item.description}
                    value={formatGbp(item.amount_pence)}
                  />
                ))}
              </tbody>
            </table>
          </>
        )}

        <div style={styles.actions}>
          <button style={{ ...styles.button, ...styles.confirm }} onClick={handleConfirm}>
            Confirm
          </button>
          <button style={{ ...styles.button, ...styles.cancel }} onClick={handleCancel}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Upload payslip</h2>
      <div
        style={{ ...styles.dropzone, ...(isDragging ? styles.dropzoneDragging : {}) }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <p style={styles.dropzoneText}>Drop a PDF or image here, or click to browse</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { fontFamily: "system-ui", padding: "1rem", maxWidth: "28rem" },
  heading: { marginTop: 0, marginBottom: "0.5rem", fontSize: "1rem" },
  subheading: {
    marginTop: "1rem",
    marginBottom: "0.5rem",
    fontSize: "0.875rem",
    color: "#555",
  },
  source: { fontSize: "0.75rem", color: "#888", marginBottom: "1rem" },
  table: { borderCollapse: "collapse", width: "100%", marginBottom: "1.25rem" },
  label: { padding: "0.3rem 0.75rem 0.3rem 0", color: "#666", whiteSpace: "nowrap" },
  value: { padding: "0.3rem 0", fontVariantNumeric: "tabular-nums" },
  actions: { display: "flex", gap: "0.5rem" },
  button: {
    padding: "0.4rem 1rem",
    border: "none",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "0.875rem",
  },
  confirm: { background: "#0070f3", color: "#fff" },
  cancel: { background: "#eee", color: "#333" },
  success: { color: "#0a7a0a" },
  error: { color: "#c0392b" },
  muted: { color: "#888", fontFamily: "system-ui", padding: "1rem" },
  dropzone: {
    border: "2px dashed #ccc",
    borderRadius: "8px",
    padding: "2rem",
    textAlign: "center",
    cursor: "pointer",
    transition: "border-color 0.2s",
  },
  dropzoneDragging: { borderColor: "#0070f3", background: "#f0f7ff" },
  dropzoneText: { margin: 0, color: "#666", fontSize: "0.875rem" },
};

createRoot(document.getElementById("root")!).render(<UploadApp />);
