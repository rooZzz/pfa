import { useId, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { MonthCoverage, SeriesStatus } from "../net_worth/coverage.js";

export type IconName =
  | "refresh"
  | "sync"
  | "upload"
  | "file"
  | "check"
  | "plug"
  | "arrowUp"
  | "arrowDown"
  | "clock"
  | "info"
  | "bank"
  | "chevron";

const ICON_PATHS: Record<IconName, ReactNode> = {
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 4v4h-4" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 20v-4h4" />
    </>
  ),
  sync: (
    <>
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 4v4h-4" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 20v-4h4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M5 20h14" />
    </>
  ),
  file: (
    <>
      <path d="M14 3v5h5" />
      <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  plug: (
    <>
      <path d="M9 2v6M15 2v6" />
      <path d="M7 8h10v3a5 5 0 0 1-10 0z" />
      <path d="M12 16v6" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M6 13l6 6 6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  bank: (
    <>
      <path d="M3 10 12 4l9 6" />
      <path d="M5 10v8M19 10v8M9 10v8M15 10v8" />
      <path d="M3 21h18" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />,
};

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm";
  block?: boolean;
  icon?: IconName;
};

export function Btn({
  variant = "secondary",
  size,
  block,
  icon,
  children,
  ...rest
}: ButtonProps) {
  const cls = ["btn", `btn-${variant}`];
  if (size === "sm") cls.push("btn-sm");
  if (block) cls.push("btn-block");
  return (
    <button className={cls.join(" ")} {...rest}>
      {icon && (
        <span className="ico">
          <Icon name={icon} size={14} />
        </span>
      )}
      {children}
    </button>
  );
}

export type Tone = "pos" | "neg" | "faint" | "muted" | "accent";

export function Stat({
  label,
  value,
  delta,
  deltaTone,
  big,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: Tone;
  big?: boolean;
}) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={"stat-value" + (big ? " lg" : "")}>{value}</span>
      {delta && (
        <span className={"stat-delta " + (deltaTone ?? "faint")}>
          {deltaTone === "pos" && <Icon name="arrowUp" size={12} />}
          {deltaTone === "neg" && <Icon name="arrowDown" size={12} />}
          {delta}
        </span>
      )}
    </div>
  );
}

export function Badge({
  tone,
  led,
  children,
}: {
  tone?: "accent" | "ok" | "warn";
  led?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={"badge" + (tone ? " " + tone : "")}>
      {led && <span className="led" />}
      {children}
    </span>
  );
}

export function Meter({
  name,
  value,
  pct,
  tone,
  sub,
}: {
  name: string;
  value: string;
  pct: number;
  tone?: "neg" | "pos" | "muted";
  sub?: string;
}) {
  return (
    <div className="meter">
      <div className="meter-top">
        <span className="meter-name">
          {name}
          {sub && <span className="meter-sub">{sub}</span>}
        </span>
        <span className="meter-val">{value}</span>
      </div>
      <div className="meter-track">
        <div
          className={"meter-fill" + (tone ? " " + tone : "")}
          style={{ width: Math.min(100, Math.max(2, pct)) + "%" }}
        />
      </div>
    </div>
  );
}

export function Sparkline({
  data,
  width = 240,
  height = 48,
  tone = "accent",
  fill = true,
}: {
  data: number[];
  width?: number;
  height?: number;
  tone?: "pos" | "neg" | "accent";
  fill?: boolean;
}) {
  const gradientId = useId();
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 3;
  const stepX = (width - pad * 2) / (data.length - 1);
  const points = data.map((v, i) => {
    const x = pad + i * stepX;
    const y = pad + (height - pad * 2) * (1 - (v - min) / span);
    return [x, y] as const;
  });
  const line = points
    .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1))
    .join(" ");
  const area =
    line + ` L${(width - pad).toFixed(1)} ${height - pad} L${pad} ${height - pad} Z`;
  const color =
    tone === "pos"
      ? "var(--positive)"
      : tone === "neg"
        ? "var(--negative)"
        : "var(--chart-ink)";
  const last = points[points.length - 1]!;
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gradientId})`} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={last[0]}
        cy={last[1]}
        r="2.4"
        fill="var(--surface)"
        stroke={color}
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function MiniBars({
  rows,
  height = 70,
}: {
  rows: { label: string; in: number; out: number }[];
  height?: number;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.in, r.out]));
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height }}>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 3,
              height,
              width: "100%",
              justifyContent: "center",
            }}
          >
            <span
              style={{
                width: 6,
                height: Math.max(2, (r.in / max) * height) + "px",
                background: "var(--positive)",
                borderRadius: 2,
                opacity: 0.85,
              }}
            />
            <span
              style={{
                width: 6,
                height: Math.max(2, (r.out / max) * height) + "px",
                background: "var(--negative)",
                borderRadius: 2,
                opacity: 0.7,
              }}
            />
          </div>
          <span
            className="num"
            style={{ fontSize: "var(--text-2xs)", color: "var(--ink-faint)" }}
          >
            {r.label}
          </span>
        </div>
      ))}
    </div>
  );
}

const COVERAGE_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const COVERAGE_STATE_LABEL: Record<MonthCoverage["state"], string> = {
  complete: "complete",
  current: "in progress",
  incomplete: "incomplete",
  future: "upcoming",
};

function coverageMark(status: SeriesStatus): string {
  if (status.state === "missing") return "missing";
  if (status.state === "stale") {
    return status.age_days != null ? `stale ${status.age_days}d` : "stale";
  }
  return status.age_days != null && status.age_days > 0
    ? `fresh ${status.age_days}d`
    : "fresh";
}

export function CoverageGrid({ months }: { months: MonthCoverage[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (months.length === 0) return null;
  const open = openIndex != null ? months[openIndex] : null;

  return (
    <div className="coverage">
      <div
        className="coverage-grid"
        role="group"
        aria-label="Financial-year data coverage by month"
      >
        {months.map((m, i) => (
          <button
            key={`${m.year}-${m.month}`}
            type="button"
            className={"coverage-cell " + m.state}
            aria-expanded={i === openIndex}
            aria-label={`${COVERAGE_MONTHS[m.month - 1]} ${m.year}: ${COVERAGE_STATE_LABEL[m.state]}`}
            onClick={() => setOpenIndex(i === openIndex ? null : i)}
          >
            <span
              className="coverage-fill"
              style={{ height: Math.round(m.fraction_fresh * 100) + "%" }}
            />
            <span className="coverage-letter">{m.initial}</span>
          </button>
        ))}
      </div>

      {open && (
        <div className="coverage-pop" role="dialog">
          <div className="coverage-pop-head">
            <span>
              {COVERAGE_MONTHS[open.month - 1]} {open.year}
            </span>
            <span className="coverage-detail-state">
              {COVERAGE_STATE_LABEL[open.state]}
            </span>
          </div>
          {open.series.length === 0 ? (
            <span className="coverage-detail-note">
              {open.state === "future" ? "not reached yet" : "no series in scope"}
            </span>
          ) : (
            <ul className="coverage-detail-list">
              {open.series.map((s) => (
                <li key={s.label} className="coverage-detail-row">
                  <span className="coverage-series">{s.label}</span>
                  <span className={"coverage-mark " + s.state}>{coverageMark(s)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function CompositionBar({
  rows,
}: {
  rows: { label: string; value: number; tone?: Tone }[];
}) {
  const assets = rows.filter((r) => r.value > 0);
  const total = assets.reduce((sum, r) => sum + r.value, 0) || 1;
  const toneColor = (t?: Tone) =>
    t === "accent"
      ? "var(--accent)"
      : t === "pos"
        ? "var(--positive)"
        : t === "neg"
          ? "var(--negative)"
          : t === "muted"
            ? "var(--ink-muted)"
            : "var(--ink-faint)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      <div
        style={{
          display: "flex",
          height: 12,
          borderRadius: 6,
          overflow: "hidden",
          gap: 2,
        }}
      >
        {assets.map((r, i) => (
          <span
            key={i}
            title={r.label}
            style={{
              width: (r.value / total) * 100 + "%",
              background: toneColor(r.tone),
              opacity: 0.9,
            }}
          />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "var(--space-2) var(--space-4)",
        }}
      >
        {assets.map((r, i) => (
          <span
            key={i}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--text-xs)",
              color: "var(--ink-muted)",
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 2,
                background: toneColor(r.tone),
              }}
            />
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}
