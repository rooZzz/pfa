import "./styles/index.css";
import "./theme.js";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { IngestReviewResult } from "../tools/ingest_document.js";
import { Masthead } from "./branding.js";
import { Badge, Btn, Icon } from "./components.js";
import { formatGbp } from "./format.js";

type IngestResult = IngestReviewResult;

type Status = "drop" | "parsing" | "review" | "confirming" | "confirmed" | "error";

function gbpOrDash(pence: number | null | undefined): string {
  if (pence == null) return "not shown";
  return formatGbp(pence);
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

          setIngestResult(JSON.parse(text.text) as IngestResult);
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

  function reset() {
    setStatus("drop");
    setIngestResult(null);
    setErrorMessage(null);
  }

  if (error) {
    return (
      <div className="screen rise">
        <p className="note">Connection error: {error.message}</p>
      </div>
    );
  }
  if (!app) {
    return (
      <div className="screen center-min">
        <div className="loading-row">
          <span className="spinner" />
          Connecting
        </div>
      </div>
    );
  }

  if (status === "parsing" || status === "confirming") {
    return (
      <div className="screen rise center-min">
        <div className="loading-row">
          <span className="spinner" />
          {status === "parsing" ? "Parsing payslip — Haiku vision" : "Writing to store"}
        </div>
      </div>
    );
  }

  if (status === "confirmed") {
    return (
      <div className="screen rise result-ok">
        <span className="seal">
          <Icon name="check" size={22} />
        </span>
        <div>
          <div className="ok-title">Saved to ledger</div>
          <p className="muted mt-2" style={{ fontSize: "var(--text-sm)" }}>
            {confirmMessage}
          </p>
        </div>
        <Btn variant="secondary" size="sm" icon="upload" onClick={reset}>
          Upload another
        </Btn>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen rise stack">
        <p className="note">{errorMessage}</p>
        <div>
          <Btn variant="secondary" size="sm" onClick={reset}>
            Try again
          </Btn>
        </div>
      </div>
    );
  }

  if (status === "review" && ingestResult) {
    const { parsed, payload, filename } = ingestResult;
    const rows: [string, string][] = [
      ["Pay date", parsed.pay_date],
      ["Tax year", parsed.tax_year ?? "not shown"],
      ["Gross pay", gbpOrDash(parsed.gross_pence)],
      ["Taxable pay", gbpOrDash(parsed.taxable_pence)],
      ["Net pay", gbpOrDash(parsed.net_pence)],
      ["PAYE", gbpOrDash(parsed.paye_pence)],
      ["NI (employee)", gbpOrDash(parsed.ni_employee_pence)],
      ["Pension (employee)", gbpOrDash(parsed.pension_employee_pence)],
      ["Pension (employer)", gbpOrDash(parsed.pension_employer_pence)],
    ];
    return (
      <div className="screen rise">
        <Masthead
          title="Review payslip"
          sub={
            <>
              <Icon
                name="file"
                size={11}
                style={{ verticalAlign: "-1px", marginRight: 4 }}
              />
              {filename}
            </>
          }
          action={
            <Badge tone="accent" led>
              staged
            </Badge>
          }
        />

        <p className="note accent mb-4">
          Parsed by Haiku vision. Nothing is written until you confirm — human review is
          non-negotiable.
        </p>

        <div className="card card--flush">
          <table className="t compact t--inset">
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={i}>
                  <td className="muted">{k}</td>
                  <td className="col-num">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {payload.line_items.length > 0 && (
          <>
            <div className="lhead">
              <h4>Line items</h4>
            </div>
            <table className="t compact">
              <tbody>
                {payload.line_items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.description}</td>
                    <td className={"col-num" + (item.amount_pence < 0 ? " neg" : "")}>
                      {formatGbp(item.amount_pence)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="row row-2 mt-5">
          <Btn variant="primary" icon="check" onClick={() => void handleConfirm()}>
            Confirm &amp; save
          </Btn>
          <Btn variant="ghost" onClick={reset}>
            Cancel
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="screen rise">
      <Masthead title="Upload payslip" />
      <div
        className={"dropzone" + (isDragging ? " dragging" : "")}
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) processFile(file);
        }}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
      >
        <div className="dz-ico">
          <Icon name="upload" size={28} />
        </div>
        <div className="dz-title">Drop a PDF or image, or click to browse</div>
        <div className="dz-hint">payslip · pdf, jpg, png</div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) processFile(file);
          }}
        />
      </div>
      <p className="note mt-4">
        Files are parsed locally then staged for your review. Every saved row stays
        auditable back to its source document.
      </p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<UploadApp />);
