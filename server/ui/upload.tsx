import { useCallback, useRef, useState } from "react";
import type { IngestReviewResult } from "../tools/ingest_document.js";
import { Masthead } from "./branding.js";
import { ActionBar, Badge, Btn, Icon } from "./components.js";
import { DataTable } from "./data_table.js";
import type { DataRow } from "./data_table.js";
import {
  ConnectionError,
  ErrorScreen,
  LoadingScreen,
  mountScreen,
  parseToolJson,
  toolText,
  usePfaApp,
} from "./screen.js";

type IngestResult = IngestReviewResult;

type Status = "drop" | "parsing" | "review" | "confirming" | "confirmed" | "error";

function UploadApp() {
  const [status, setStatus] = useState<Status>("drop");
  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { app, error } = usePfaApp();

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

          setIngestResult(parseToolJson<IngestResult>(result, "ingest_document"));
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
      setConfirmMessage(toolText(result) ?? "Saved.");
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

  if (error) return <ConnectionError message={error.message} />;
  if (!app) return <LoadingScreen label="Connecting" />;

  if (status === "parsing" || status === "confirming") {
    return (
      <LoadingScreen
        rise
        label={
          status === "parsing" ? "Parsing payslip — Haiku vision" : "Writing to store"
        }
      />
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
          <p className="note mt-2">{confirmMessage}</p>
        </div>
        <Btn variant="secondary" size="sm" icon="upload" onClick={reset}>
          Upload another
        </Btn>
      </div>
    );
  }

  if (status === "error") {
    return (
      <ErrorScreen
        message={errorMessage}
        action={
          <Btn variant="secondary" size="sm" onClick={reset}>
            Try again
          </Btn>
        }
      />
    );
  }

  if (status === "review" && ingestResult) {
    const { parsed, payload, filename } = ingestResult;
    const textRow = (key: string, label: string, value: string | null): DataRow => ({
      key,
      label,
      labelTone: "muted",
      display: value ?? undefined,
      absence: "not_recorded",
    });
    const amountRow = (key: string, label: string, pence: number | null): DataRow => ({
      key,
      label,
      labelTone: "muted",
      valuePence: pence,
      absence: "not_recorded",
    });
    const summaryRows: DataRow[] = [
      textRow("pay_date", "Pay date", parsed.pay_date),
      textRow("tax_year", "Tax year", parsed.tax_year ?? null),
      textRow("tax_code", "Tax code", parsed.tax_code ?? null),
      amountRow("gross", "Gross pay", parsed.gross_pence),
      amountRow("taxable", "Taxable pay", parsed.taxable_pence),
      amountRow("net", "Net pay", parsed.net_pence),
      amountRow("paye", "PAYE", parsed.paye_pence),
      amountRow("ni", "NI (employee)", parsed.ni_employee_pence),
      amountRow("pension_ee", "Pension (employee)", parsed.pension_employee_pence),
      amountRow("pension_er", "Pension (employer)", parsed.pension_employer_pence),
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

        <p className="note mb-4">Nothing is written until you confirm.</p>

        <div className="card card--flush">
          <DataTable groups={[{ key: "summary", rows: summaryRows }]} />
        </div>

        {payload.line_items.length > 0 && (
          <>
            <div className="lhead">
              <h4>Line items</h4>
            </div>
            <DataTable
              inset={false}
              columns={[
                { key: "section", align: "left" },
                { key: "amount", align: "num" },
              ]}
              groups={[
                {
                  key: "line_items",
                  rows: payload.line_items.map((item, i) => ({
                    key: String(i),
                    label: item.description,
                    cells: [
                      { valuePence: null, display: item.section, tone: "muted" },
                      { valuePence: item.amount_pence },
                    ],
                  })),
                },
              ]}
            />
          </>
        )}

        <ActionBar
          secondary={
            <Btn variant="ghost" onClick={reset}>
              Cancel
            </Btn>
          }
          primary={
            <Btn variant="primary" icon="check" onClick={() => void handleConfirm()}>
              Confirm &amp; save
            </Btn>
          }
        />
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
      <p className="caption mt-4">Parsed locally, staged for review.</p>
    </div>
  );
}

mountScreen(<UploadApp />);
