import { useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./components.js";
import { formatGbp } from "./format.js";

export type DataRow = {
  key: string;
  label: ReactNode;
  valuePence: number | null;
  display?: ReactNode;
  tone?: "muted";
};

export type DataGroup = {
  key: string;
  label: string;
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
  const { visible, hidden, hiddenSumPence } = topN(ordered, (r) => r.valuePence, {
    limit: options.truncate,
    expanded: options.expanded,
  });
  return { visible, hidden, hiddenSumPence, subtotalPence };
}

function valueCell(row: DataRow): ReactNode {
  if (row.display !== undefined) return row.display;
  if (row.valuePence == null) return "unknown";
  return formatGbp(row.valuePence);
}

function valueColor(row: DataRow): string | undefined {
  if (row.tone === "muted") return "var(--ink-muted)";
  if (row.valuePence != null && row.valuePence < 0) return "var(--negative)";
  return undefined;
}

function DisclosureToggle({
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
    <button className="btn btn-ghost btn-sm" onClick={onToggle}>
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

function GroupBody({ group }: { group: DataGroup }) {
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
      <tr className="group-row">
        <td className="group-name">{group.label}</td>
        <td className="col-num group-sub">
          {subtotal == null ? "" : formatGbp(subtotal)}
        </td>
      </tr>
      {visible.map((row) => (
        <tr key={row.key}>
          <td style={row.tone === "muted" ? { color: "var(--ink-muted)" } : undefined}>
            {row.label}
          </td>
          <td className="col-num" style={{ color: valueColor(row) }}>
            {valueCell(row)}
          </td>
        </tr>
      ))}
      {isTruncatable && (
        <tr className="row-more">
          <td>
            <DisclosureToggle
              expanded={expanded}
              hiddenCount={hidden.length || hiddenCount}
              hiddenSumPence={hiddenSumPence}
              onToggle={() => setExpanded(!expanded)}
            />
          </td>
          <td className="col-num" />
        </tr>
      )}
    </tbody>
  );
}

export function DataTable({
  groups,
  footer,
  compact = true,
  inset = true,
}: {
  groups: DataGroup[];
  footer?: { label: string; valuePence: number };
  compact?: boolean;
  inset?: boolean;
}) {
  const cls = ["t"];
  if (compact) cls.push("compact");
  if (inset) cls.push("t--inset");
  return (
    <table className={cls.join(" ")}>
      {groups.map((group) => (
        <GroupBody key={group.key} group={group} />
      ))}
      {footer && (
        <tfoot>
          <tr>
            <td>{footer.label}</td>
            <td className="col-num">{formatGbp(footer.valuePence)}</td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
