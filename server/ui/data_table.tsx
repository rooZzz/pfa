import { useState } from "react";
import type { ReactNode } from "react";
import { Icon, Meter } from "./components.js";
import { formatGbp, ABSENCE_LABEL } from "./format.js";
import type { Absence } from "./format.js";

export type RowTone = "muted" | "pos" | "neg";

export type Cell = {
  valuePence: number | null;
  display?: ReactNode;
  tone?: RowTone;
  absence?: Absence;
  align?: "left" | "num";
};

export type DataRow = {
  key: string;
  label: ReactNode;
  sub?: ReactNode;
  tone?: RowTone;
  labelTone?: RowTone;
  valuePence?: number | null;
  display?: ReactNode;
  absence?: Absence;
  cells?: Cell[];
  bar?: { pct: number; tone?: RowTone };
};

export type DataColumn = {
  key: string;
  header?: string;
  align?: "left" | "num";
};

export type DataGroup = {
  key: string;
  label?: ReactNode;
  rows: DataRow[];
  subtotalPence?: number | null;
  truncate?: number;
  sortByValue?: boolean;
};

export type GroupPartition = {
  visible: DataRow[];
  hidden: DataRow[];
  hiddenSumPence: number;
  subtotalPence: number;
};

export type TopN<T> = {
  visible: T[];
  hidden: T[];
  hiddenSumPence: number;
};

export function topN<T>(
  items: T[],
  getValuePence: (item: T) => number | null,
  options: { limit?: number; expanded?: boolean },
): TopN<T> {
  const limit = options.limit;
  if (limit == null || options.expanded || items.length <= limit) {
    return { visible: items, hidden: [], hiddenSumPence: 0 };
  }
  const visible = items.slice(0, limit);
  const hidden = items.slice(limit);
  const hiddenSumPence = hidden.reduce((sum, it) => sum + (getValuePence(it) ?? 0), 0);
  return { visible, hidden, hiddenSumPence };
}

export function partitionGroupRows(
  rows: DataRow[],
  options: { truncate?: number; sortByValue?: boolean; expanded?: boolean },
): GroupPartition {
  const ordered = options.sortByValue
    ? [...rows].sort(
        (a, b) =>
          (b.valuePence ?? Number.NEGATIVE_INFINITY) -
          (a.valuePence ?? Number.NEGATIVE_INFINITY),
      )
    : rows;

  const subtotalPence = rows.reduce((sum, r) => sum + (r.valuePence ?? 0), 0);
  const { visible, hidden, hiddenSumPence } = topN(ordered, (r) => r.valuePence ?? null, {
    limit: options.truncate,
    expanded: options.expanded,
  });
  return { visible, hidden, hiddenSumPence, subtotalPence };
}

function toneVar(tone?: RowTone): string | undefined {
  if (tone === "muted") return "var(--ink-muted)";
  if (tone === "pos") return "var(--positive)";
  if (tone === "neg") return "var(--negative)";
  return undefined;
}

function cellContent(cell: {
  valuePence?: number | null;
  display?: ReactNode;
  absence?: Absence;
}): ReactNode {
  if (cell.display !== undefined) return cell.display;
  if (cell.valuePence != null) return formatGbp(cell.valuePence);
  return ABSENCE_LABEL[cell.absence ?? "not_recorded"];
}

function cellColor(cell: Cell, rowTone?: RowTone): string | undefined {
  const tone = cell.tone ?? rowTone;
  if (tone) return toneVar(tone);
  if (cell.absence === "na") return "var(--ink-muted)";
  if (cell.valuePence != null && cell.valuePence < 0) return "var(--negative)";
  return undefined;
}

export function DisclosureToggle({
  expanded,
  hiddenCount,
  hiddenSumPence,
  onToggle,
}: {
  expanded: boolean;
  hiddenCount: number;
  hiddenSumPence: number;
  onToggle: () => void;
}) {
  return (
    <button className="btn btn-ghost btn-sm disclosure-toggle" onClick={onToggle}>
      <span
        className="ico"
        style={expanded ? { transform: "rotate(180deg)" } : undefined}
      >
        <Icon name="chevron" size={14} />
      </span>
      {expanded ? "Show less" : `Show ${hiddenCount} more · ${formatGbp(hiddenSumPence)}`}
    </button>
  );
}

const DEFAULT_COLUMNS: DataColumn[] = [{ key: "value", align: "num" }];

function valueCells(row: DataRow, columns: DataColumn[]): ReactNode {
  if (row.cells) {
    return columns.map((col, i) => {
      const cell = row.cells![i] ?? { valuePence: null };
      const align = cell.align ?? col.align ?? "num";
      return (
        <td
          key={col.key}
          className={align === "num" ? "col-num" : undefined}
          style={{ color: cellColor(cell, row.tone) }}
        >
          {cellContent(cell)}
        </td>
      );
    });
  }
  const single: Cell = {
    valuePence: row.valuePence ?? null,
    display: row.display,
    absence: row.absence,
    tone: row.tone,
  };
  return columns.map((col, i) => {
    if (i > 0) return <td key={col.key} className="col-num" />;
    const align = col.align ?? "num";
    return (
      <td
        key={col.key}
        className={align === "num" ? "col-num" : undefined}
        style={{ color: cellColor(single, row.tone) }}
      >
        {cellContent(single)}
      </td>
    );
  });
}

function GroupBody({ group, columns }: { group: DataGroup; columns: DataColumn[] }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden, hiddenSumPence, subtotalPence } = partitionGroupRows(
    group.rows,
    {
      truncate: group.truncate,
      sortByValue: group.sortByValue,
      expanded,
    },
  );

  const subtotal =
    group.subtotalPence !== undefined ? group.subtotalPence : subtotalPence;
  const isTruncatable = group.truncate != null && group.rows.length > group.truncate;
  const hiddenCount = isTruncatable ? group.rows.length - group.truncate! : 0;

  return (
    <tbody>
      {group.label != null && (
        <tr className="group-row">
          <td className="group-name">{group.label}</td>
          <td className="col-num group-sub" colSpan={columns.length}>
            {subtotal == null ? "" : formatGbp(subtotal)}
          </td>
        </tr>
      )}
      {visible.map((row) => {
        const labelTone = row.labelTone ?? (row.tone === "muted" ? "muted" : undefined);
        return (
          <tr key={row.key}>
            <td style={labelTone ? { color: toneVar(labelTone) } : undefined}>
              {row.label}
              {row.sub != null && <span className="sub">{row.sub}</span>}
            </td>
            {valueCells(row, columns)}
          </tr>
        );
      })}
      {isTruncatable && (
        <tr className="row-more">
          <td colSpan={columns.length + 1}>
            <DisclosureToggle
              expanded={expanded}
              hiddenCount={hidden.length || hiddenCount}
              hiddenSumPence={hiddenSumPence}
              onToggle={() => setExpanded(!expanded)}
            />
          </td>
        </tr>
      )}
    </tbody>
  );
}

function BarGroup({ group }: { group: DataGroup }) {
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden, hiddenSumPence } = partitionGroupRows(group.rows, {
    truncate: group.truncate,
    sortByValue: group.sortByValue,
    expanded,
  });
  const isTruncatable = group.truncate != null && group.rows.length > group.truncate;
  const hiddenCount = isTruncatable ? group.rows.length - group.truncate! : 0;

  return (
    <div className="stack-3">
      {group.label != null && <span className="card-label">{group.label}</span>}
      {visible.map((row) => (
        <Meter
          key={row.key}
          name={row.label}
          sub={row.sub}
          value={cellContent(row)}
          pct={row.bar?.pct ?? 0}
          tone={row.bar?.tone}
        />
      ))}
      {isTruncatable && (
        <DisclosureToggle
          expanded={expanded}
          hiddenCount={hidden.length || hiddenCount}
          hiddenSumPence={hiddenSumPence}
          onToggle={() => setExpanded(!expanded)}
        />
      )}
    </div>
  );
}

export function DataTable({
  groups,
  columns,
  labelHeader,
  footer,
  variant = "rows",
  compact = true,
  inset = true,
}: {
  groups: DataGroup[];
  columns?: DataColumn[];
  labelHeader?: string;
  footer?: { label: string; valuePence: number };
  variant?: "rows" | "bars";
  compact?: boolean;
  inset?: boolean;
}) {
  if (variant === "bars") {
    return (
      <div className="stack">
        {groups.map((group) => (
          <BarGroup key={group.key} group={group} />
        ))}
      </div>
    );
  }

  const cols = columns ?? DEFAULT_COLUMNS;
  const hasHeader = cols.some((c) => c.header);
  const cls = ["t"];
  if (compact) cls.push("compact");
  if (inset) cls.push("t--inset");
  return (
    <div className={cols.length > 1 ? "t-wrap t-wrap--multi" : "t-wrap"}>
      <table className={cls.join(" ")}>
        {(hasHeader || labelHeader != null) && (
          <thead>
            <tr>
              <th>{labelHeader}</th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={(c.align ?? "num") === "num" ? "col-num" : undefined}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        {groups.map((group) => (
          <GroupBody key={group.key} group={group} columns={cols} />
        ))}
        {footer && (
          <tfoot>
            <tr>
              <td>{footer.label}</td>
              <td className="col-num" colSpan={cols.length}>
                {formatGbp(footer.valuePence)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
