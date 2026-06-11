import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  ContingentLine,
  NetWorthResult,
  RealisedLine,
  UnscheduledLine,
} from "../net_worth/types.js";
import { Masthead } from "./branding.js";
import {
  Btn,
  CollapsibleSection,
  CompositionBar,
  CoverageGrid,
  Icon,
  Sparkline,
  TickerChip,
} from "./components.js";
import { GoalsSection } from "./goals_section.js";
import type { Directive } from "./goals_section.js";
import { categoryGlyph, institutionToGlyph } from "./logos.js";
import { DataTable } from "./data_table.js";
import type { DataGroup } from "./data_table.js";
import { ABSENCE_LABEL, formatGbp, formatGbpk } from "./format.js";
import type { ClassOutcome, DataClass } from "../core/freshness.js";
import {
  ConnectionError,
  ErrorScreen,
  LoadingScreen,
  mountScreen,
  parseToolJson,
  toolText,
  usePfaApp,
} from "./screen.js";

function monthYear(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleString("en-GB", { month: "short", year: "2-digit" });
}

type NetWorthData = NetWorthResult;

function daysSince(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const then = new Date(dateStr).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24));
}

function ageLabel(days: number | null): string {
  if (days === null) return ABSENCE_LABEL.no_date;
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function sumKind(lines: RealisedLine[], kind: RealisedLine["kind"]): number {
  return lines.filter((l) => l.kind === kind).reduce((sum, l) => sum + l.value_pence, 0);
}

function parseBriefingDirectives(
  settled: PromiseSettledResult<unknown>,
): Directive[] | null {
  if (settled.status !== "fulfilled") return null;
  const text = toolText(settled.value as { content?: { type: string }[] });
  if (!text) return null;
  try {
    const briefing = JSON.parse(text) as { directives?: Directive[] };
    return briefing.directives ?? null;
  } catch {
    return null;
  }
}

const staleBadge = (
  <span className="badge warn ml-2">
    <span className="led" />
    stale
  </span>
);

const outdatedBadge = (
  <span className="badge warn ml-2">
    <span className="led" />
    outdated
  </span>
);

function classesForGroupKey(key: string): DataClass[] {
  if (key === "account") return ["monzo"];
  if (key === "asset") return ["prices", "ethereum"];
  return [];
}

function groupStatusLabel(
  label: string,
  key: string,
  refreshing: Set<DataClass>,
  failed: Set<DataClass>,
): ReactNode {
  const classes = classesForGroupKey(key);
  const isRefreshing = classes.some((c) => refreshing.has(c));
  const isFailed = classes.some((c) => failed.has(c));
  if (!isRefreshing && !isFailed) return label;
  return (
    <>
      {label}
      {isRefreshing && <span className="spinner ml-2" />}
      {isFailed && outdatedBadge}
    </>
  );
}

function TickerLead({ ticker }: { ticker: string }) {
  return (
    <>
      <TickerChip ticker={ticker} /> {ticker}
    </>
  );
}

function assetLead(ticker: string | null, fallbackName: string | null): ReactNode {
  if (ticker) return <TickerLead ticker={ticker} />;
  return fallbackName ?? ABSENCE_LABEL.not_recorded;
}

function GlyphMark({ svg, label }: { svg: string; label?: string }) {
  return (
    <span
      className="ticker-mark"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function LineMark({ line }: { line: RealisedLine }) {
  if (line.kind === "asset") return <TickerChip ticker={line.ticker ?? null} />;
  const brand = institutionToGlyph(line.institution);
  const svg = brand ?? categoryGlyph(line.kind);
  if (svg) return <GlyphMark svg={svg} label={line.institution ?? line.kind} />;
  return <TickerChip ticker={line.ticker ?? null} />;
}

function realisedSub(line: RealisedLine): ReactNode {
  if (line.kind === "asset" && line.quantity != null && line.unit_price_pence != null) {
    const qty = (line.quantity / (line.quantity_scale ?? 1)).toLocaleString(undefined, {
      maximumFractionDigits: 8,
    });
    return `${qty} × ${formatGbp(line.unit_price_pence)}`;
  }
  return null;
}

function realisedRowLabel(line: RealisedLine): ReactNode {
  const priceAge = line.kind === "asset" ? daysSince(line.price_as_of) : null;
  const isStale = priceAge != null && priceAge > 30;
  const sub = realisedSub(line);
  return (
    <span className="line-lead">
      <LineMark line={line} />
      <span className="line-name">
        {line.name}
        {sub && <span className="sub sub-inline">{sub}</span>}
      </span>
      {isStale && staleBadge}
    </span>
  );
}

function isSayeFloor(line: ContingentLine): boolean {
  return (
    line.scheme_type === "saye" &&
    line.savings_floor_pence != null &&
    (line.price_per_unit_pence == null ||
      line.strike_pence == null ||
      line.price_per_unit_pence <= line.strike_pence)
  );
}

function SavingsFloorBadge({ line }: { line: ContingentLine }) {
  const [open, setOpen] = useState(false);
  const [placeUp, setPlaceUp] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const toggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPlaceUp(window.innerHeight - rect.bottom < 96);
    }
    setOpen((o) => !o);
  };
  useLayoutEffect(() => {
    if (!open) {
      setShiftX(0);
      return;
    }
    const rect = popRef.current?.getBoundingClientRect();
    if (rect && rect.left < 16) setShiftX(16 - rect.left);
  }, [open]);
  const total = line.savings_floor_pence ?? 0;
  const monthly = line.monthly_contribution_pence;
  const months = monthly && monthly > 0 ? Math.round(total / monthly) : null;
  const priceLine =
    line.price_per_unit_pence != null && line.strike_pence != null
      ? `Current price ${formatGbp(line.price_per_unit_pence)} under option price ${formatGbp(line.strike_pence)}.`
      : "No current price; held under the option price.";
  const savingsLine =
    monthly != null && months != null
      ? `${formatGbp(monthly)}/mo for ${months} months is ${formatGbp(total)}.`
      : `Savings returned: ${formatGbp(total)}.`;
  return (
    <span className="floor-wrap">
      <button
        ref={btnRef}
        type="button"
        className="floor-badge"
        aria-label="Why this value is the savings floor"
        onClick={toggle}
      >
        <Icon name="info" size={11} />
      </button>
      {open && (
        <span
          ref={popRef}
          className={"floor-pop" + (placeUp ? " floor-pop--up" : "")}
          style={shiftX ? { transform: `translateX(${shiftX}px)` } : undefined}
          role="tooltip"
        >
          {priceLine}
          <br />
          {savingsLine}
        </span>
      )}
    </span>
  );
}

function vestValueDisplay(line: ContingentLine): ReactNode | undefined {
  if (!isSayeFloor(line)) return undefined;
  return (
    <span className="val-floor">
      <SavingsFloorBadge line={line} />
      {formatGbp(line.projected_value_pence ?? line.savings_floor_pence ?? 0)}
    </span>
  );
}

function vestDetail(line: ContingentLine): string {
  const parts: string[] = [
    line.price_per_unit_pence != null
      ? `${formatGbp(line.price_per_unit_pence)}/unit`
      : "no price",
  ];
  if (line.strike_pence != null) {
    parts.push(`${formatGbp(line.strike_pence)} option price`);
  }
  if (
    line.scheme_type === "saye" &&
    line.savings_floor_pence != null &&
    !isSayeFloor(line)
  ) {
    parts.push(`+${formatGbp(line.savings_floor_pence)} savings`);
  }
  return parts.join(" · ");
}

function vestRowLabel(line: ContingentLine): ReactNode {
  const priceAge = daysSince(line.price_as_of ?? undefined);
  const isStale = priceAge != null && priceAge > 30;
  const scheme = `${line.units.toLocaleString()} ${line.scheme_type.toUpperCase()}`;
  return (
    <>
      {assetLead(line.ticker, line.asset_name)}
      <span className="sub sub-inline">
        {scheme} · {vestDetail(line)} · vests {line.vest_date} · {ageLabel(priceAge)}
      </span>
      {isStale && staleBadge}
    </>
  );
}

function unscheduledRowLabel(line: UnscheduledLine): ReactNode {
  const scheme = `${line.units.toLocaleString()} ${line.scheme_type.toUpperCase()}`;
  return (
    <>
      {assetLead(line.ticker, line.asset_name)}
      <span className="sub sub-inline">{scheme} · vest dates not recorded</span>
    </>
  );
}

function splitMortgageName(name: string): { lender: string; property: string } {
  const idx = name.indexOf(" — ");
  if (idx === -1) return { lender: "", property: name };
  return { lender: name.slice(0, idx), property: name.slice(idx + 3) };
}

function propertyItemLabel(
  name: string,
  property: RealisedLine | undefined,
  mortgage: RealisedLine | undefined,
): ReactNode {
  const split = splitMortgageName(name);
  const parts: string[] = [];
  if (split.lender) parts.push(split.lender);
  if (property) parts.push(`${formatGbpk(property.value_pence)} value`);
  if (mortgage) parts.push(`${formatGbpk(-mortgage.value_pence)} mortgage`);
  return (
    <span className="line-lead">
      <GlyphMark svg={categoryGlyph("property") ?? ""} label="property" />
      <span className="line-name">
        {split.property}
        <span className="sub sub-inline">{parts.join(" · ")}</span>
      </span>
    </span>
  );
}

function buildPropertyGroup(realised: RealisedLine[]): DataGroup | null {
  const byName = new Map<string, { property?: RealisedLine; mortgage?: RealisedLine }>();
  for (const line of realised) {
    if (line.kind !== "property" && line.kind !== "mortgage") continue;
    const entry = byName.get(line.name) ?? {};
    if (line.kind === "property") entry.property = line;
    else entry.mortgage = line;
    byName.set(line.name, entry);
  }
  if (byName.size === 0) return null;
  const rows = [...byName.entries()].map(([name, entry], i) => ({
    key: `property-${i}`,
    label: propertyItemLabel(name, entry.property, entry.mortgage),
    valuePence: (entry.property?.value_pence ?? 0) + (entry.mortgage?.value_pence ?? 0),
  }));
  return { key: "property", label: "Property", rows };
}

function buildRealisedGroups(
  realised: RealisedLine[],
  refreshing: Set<DataClass>,
  failed: Set<DataClass>,
): DataGroup[] {
  const groups: DataGroup[] = FLAT_GROUPS.map((g) => ({
    kind: g.kind,
    label: g.label,
    lines: realised.filter((l) => l.kind === g.kind),
  }))
    .filter((g) => g.lines.length > 0)
    .map((g) => ({
      key: g.kind,
      label: groupStatusLabel(g.label, g.kind, refreshing, failed),
      truncate: 5,
      sortByValue: true,
      rows: g.lines.map((line, i) => ({
        key: `${g.kind}-${i}`,
        label: realisedRowLabel(line),
        valuePence: line.value_pence,
      })),
    }));

  const propertyGroup = buildPropertyGroup(realised);
  if (propertyGroup) groups.push(propertyGroup);
  return groups;
}

function buildVestGroups(
  contingent: ContingentLine[],
  unscheduled: UnscheduledLine[],
): DataGroup[] {
  const byYear = new Map<string, ContingentLine[]>();
  for (const line of contingent) {
    const year = line.vest_date.split("-")[0]!;
    const bucket = byYear.get(year);
    if (bucket) bucket.push(line);
    else byYear.set(year, [line]);
  }

  const groups: DataGroup[] = [...byYear.entries()].map(([year, lines]) => ({
    key: year,
    label: year,
    rows: lines.map((line, i) => ({
      key: `${year}-${i}`,
      label: vestRowLabel(line),
      valuePence: line.projected_value_pence,
      display: vestValueDisplay(line),
    })),
  }));

  if (unscheduled.length > 0) {
    groups.push({
      key: "unscheduled",
      label: "Not yet scheduled",
      subtotalPence: null,
      rows: unscheduled.map((line, i) => ({
        key: `unscheduled-${i}`,
        label: unscheduledRowLabel(line),
        valuePence: null,
        absence: "na",
        labelTone: "muted",
      })),
    });
  }

  return groups;
}

const FLAT_GROUPS: { kind: RealisedLine["kind"]; label: string }[] = [
  { kind: "account", label: "Cash" },
  { kind: "asset", label: "Investments" },
  { kind: "pension", label: "Pension" },
];

function NetWorthApp() {
  const [data, setData] = useState<NetWorthData | null>(null);
  const [goals, setGoals] = useState<Directive[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState<Set<DataClass>>(new Set());
  const [failed, setFailed] = useState<Set<DataClass>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { app, error } = usePfaApp();

  const fetchData = useCallback(async (): Promise<NetWorthData | null> => {
    if (!app) return null;
    const today = new Date().toISOString().split("T")[0]!;
    const [nwSettled, brSettled] = await Promise.allSettled([
      app.callServerTool({
        name: "get_net_worth",
        arguments: { as_of: today, auto_refresh: false },
      }),
      app.callServerTool({
        name: "get_briefing",
        arguments: { as_of: today, auto_refresh: false },
      }),
    ]);

    if (nwSettled.status === "rejected") throw nwSettled.reason;
    const parsed = parseToolJson<NetWorthData>(nwSettled.value, "get_net_worth");
    setData(parsed);
    setGoals(parseBriefingDirectives(brSettled));
    return parsed;
  }, [app]);

  const runRefresh = useCallback(
    async (spinnerClasses: DataClass[], requestClasses: DataClass[] | null) => {
      if (!app || spinnerClasses.length === 0) return;
      setFailed(new Set());
      setRefreshing(new Set(spinnerClasses));
      try {
        const result = await app.callServerTool({
          name: "refresh_stale_data",
          arguments: requestClasses ? { classes: requestClasses } : {},
        });
        const text = toolText(result);
        const outcomes = text ? (JSON.parse(text) as ClassOutcome[]) : [];
        await fetchData();
        setFailed(
          new Set(outcomes.filter((o) => o.action === "failed").map((o) => o.class)),
        );
      } catch {
        setFailed(new Set(spinnerClasses));
      } finally {
        setRefreshing(new Set());
      }
    },
    [app, fetchData],
  );

  const load = useCallback(async () => {
    if (!app) return;
    setLoading(true);
    setErrorMessage(null);
    try {
      const parsed = await fetchData();
      const stale =
        parsed?.freshness.filter((f) => f.connected && f.is_stale).map((f) => f.class) ??
        [];
      if (stale.length > 0) void runRefresh(stale, stale);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, [app, fetchData, runRefresh]);

  const manualRefresh = useCallback(async () => {
    if (!app) return;
    setBusy(true);
    setErrorMessage(null);
    setFailed(new Set());
    try {
      const parsed = await fetchData();
      const connected =
        parsed?.freshness.filter((f) => f.connected).map((f) => f.class) ?? [];
      await runRefresh(connected, null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setBusy(false);
    }
  }, [app, fetchData, runRefresh]);

  useEffect(() => {
    if (app) void load();
  }, [app, load]);

  if (error) return <ConnectionError message={error.message} />;
  if (!app || loading) {
    return <LoadingScreen label={app ? "Loading net worth" : "Connecting"} />;
  }
  if (errorMessage) {
    return (
      <ErrorScreen
        message={errorMessage}
        action={
          <Btn variant="secondary" size="sm" icon="refresh" onClick={() => void load()}>
            Retry
          </Btn>
        }
      />
    );
  }
  if (!data) return <LoadingScreen label="Loading net worth" />;

  const trendVals = data.trend.map((t) => t.realised_total_pence);
  const first = trendVals[0];
  const last = trendVals[trendVals.length - 1];
  const change = first != null && last != null ? last - first : null;
  const changePct =
    change != null && first ? ((change / Math.abs(first)) * 100).toFixed(1) : null;

  const cash = sumKind(data.realised, "account");
  const investments = sumKind(data.realised, "asset");
  const pension = sumKind(data.realised, "pension");
  const property = sumKind(data.realised, "property");

  const composition = [
    { label: "Property", value: property },
    { label: "Pension", value: pension },
    { label: "Investments", value: investments },
    { label: "Cash", value: cash },
  ];

  const realisedGroups = buildRealisedGroups(data.realised, refreshing, failed);
  const vestGroups = buildVestGroups(data.contingent, data.contingent_unscheduled);
  const hasContingent = vestGroups.length > 0;

  return (
    <div className="screen rise stack">
      <Masthead
        tight
        title="Net worth"
        sub={`As of ${data.as_of}`}
        action={
          <div className="screen-actions">
            {data.coverage.length > 0 && <CoverageGrid months={data.coverage} />}
            <Btn
              variant="secondary"
              size="sm"
              icon="refresh"
              onClick={() => void manualRefresh()}
              disabled={busy}
            >
              {busy ? "Refreshing" : "Refresh"}
            </Btn>
          </div>
        }
      />

      <div>
        <div className="figure-hero">
          {formatGbp(data.realised_total_pence, { whole: true })}
        </div>
        {change != null && (
          <div className={"stat-delta mt-2 " + (change >= 0 ? "pos" : "neg")}>
            {(change >= 0 ? "+" : "") + formatGbpk(change)}
            {changePct != null ? ` (${changePct}%)` : ""} over {trendVals.length} months
          </div>
        )}
      </div>

      {trendVals.length > 1 && (
        <div className="card card--chart">
          <Sparkline
            data={trendVals}
            height={120}
            startLabel={monthYear(data.trend[0]!.date)}
            endLabel={monthYear(data.trend[data.trend.length - 1]!.date)}
          />
        </div>
      )}

      <div className="card">
        <div className="card-label mb-3">Composition</div>
        <CompositionBar rows={composition} />
      </div>

      {goals !== null && <GoalsSection directives={goals} />}

      <CollapsibleSection
        title="Breakdown"
        defaultOpen={false}
        summary={`${data.realised.length} line${
          data.realised.length === 1 ? "" : "s"
        } · ${formatGbpk(data.realised_total_pence)}`}
      >
        <div className="card card--flush">
          <DataTable
            groups={realisedGroups}
            footer={{ label: "Total realised", valuePence: data.realised_total_pence }}
          />
        </div>
      </CollapsibleSection>

      {hasContingent && (
        <CollapsibleSection
          title="Upcoming vests"
          defaultOpen={false}
          hint="valued at latest captured price · excluded from total"
          summary={`${data.contingent.length} vest${
            data.contingent.length === 1 ? "" : "s"
          } · ${formatGbpk(data.contingent_total_pence)}`}
        >
          <div className="card card--flush">
            <DataTable
              groups={vestGroups}
              footer={
                data.contingent_total_pence > 0
                  ? {
                      label: "Total upcoming (est.)",
                      valuePence: data.contingent_total_pence,
                    }
                  : undefined
              }
            />
          </div>
        </CollapsibleSection>
      )}

      {data.unknown.length > 0 && (
        <div className="note">
          No observations at {data.as_of} for: {data.unknown.join(", ")}.
        </div>
      )}
    </div>
  );
}

mountScreen(<NetWorthApp />);
