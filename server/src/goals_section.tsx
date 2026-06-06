import { Badge, Icon, Meter } from "./components.js";
import { formatGbp, formatGbpk } from "./format.js";

export type DirectiveKind = "progress" | "deadline" | "data_gap" | "contention";

export type Directive = {
  goal_id: number;
  goal_type: string;
  sub_goal: string;
  kind: DirectiveKind;
  message: string;
  data: Record<string, number | string>;
};

type GoalView = {
  goal_id: number;
  goal_type: string;
  progress: Directive | null;
  deadlines: Directive[];
  data_gap: Directive | null;
};

function goalLabel(goal_type: string, progress: Directive | null): string {
  if (goal_type === "emergency_fund") return "Emergency Fund";
  if (goal_type === "house_deposit") return "House Deposit";
  if (goal_type === "isa_max") {
    const year = progress?.data.tax_year;
    return year ? `ISA Allowance ${year}` : "ISA Allowance";
  }
  return goal_type
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function groupDirectives(directives: Directive[]): { goals: GoalView[] } {
  const map = new Map<number, GoalView>();

  for (const d of directives) {
    if (d.kind === "contention") continue;
    if (!map.has(d.goal_id)) {
      map.set(d.goal_id, {
        goal_id: d.goal_id,
        goal_type: d.goal_type,
        progress: null,
        deadlines: [],
        data_gap: null,
      });
    }
    const view = map.get(d.goal_id)!;
    if (d.kind === "progress") view.progress = d;
    else if (d.kind === "deadline") view.deadlines.push(d);
    else if (d.kind === "data_gap") view.data_gap = d;
  }

  return { goals: Array.from(map.values()) };
}

function formatDate(iso: string): string {
  const parts = iso.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return iso;
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function EmergencyFundMeter({ progress }: { progress: Directive }) {
  const months = Number(progress.data.months);
  const targetMonths = Number(progress.data.target_months);
  const percent = Number(progress.data.percent);
  const liquidPence = Number(progress.data.liquid_pence);
  const avgPence = Number(progress.data.avg_outflow_pence);
  const pct = Math.min(100, percent);
  return (
    <Meter
      name={goalLabel("emergency_fund", progress)}
      value={`${months.toFixed(1)} / ${targetMonths} months`}
      pct={pct}
      tone={pct >= 100 ? "pos" : undefined}
      sub={`${formatGbpk(liquidPence)} liquid · ${formatGbpk(avgPence)}/mo avg outgoings`}
    />
  );
}

function IsaMeter({ progress }: { progress: Directive }) {
  const remaining = Number(progress.data.remaining_pence);
  const contributions = Number(progress.data.contributions_pence);
  const allowance = Number(progress.data.allowance_pence);
  const percentUsed = Number(progress.data.percent_used);
  const pct = Math.min(100, percentUsed);
  return (
    <Meter
      name={goalLabel("isa_max", progress)}
      value={`${formatGbp(remaining)} remaining`}
      pct={pct}
      tone={pct >= 100 ? "pos" : undefined}
      sub={`${formatGbp(contributions)} of ${formatGbp(allowance)} used`}
    />
  );
}

function HouseDepositMeter({ progress }: { progress: Directive }) {
  const saved = Number(progress.data.saved_pence);
  const target = Number(progress.data.target_pence);
  const percent = Number(progress.data.percent);
  const pct = Math.min(100, percent);
  return (
    <Meter
      name={goalLabel("house_deposit", progress)}
      value={formatGbp(saved)}
      pct={pct}
      tone={pct >= 100 ? "pos" : undefined}
      sub={`of ${formatGbp(target)} target`}
    />
  );
}

function GoalMeter({ goal_type, progress }: { goal_type: string; progress: Directive }) {
  if (goal_type === "emergency_fund") return <EmergencyFundMeter progress={progress} />;
  if (goal_type === "isa_max") return <IsaMeter progress={progress} />;
  if (goal_type === "house_deposit") return <HouseDepositMeter progress={progress} />;
  return null;
}

function DeadlineRow({ directive }: { directive: Directive }) {
  const daysLeft = directive.data.days_left;
  const periodEnd = directive.data.period_end as string | undefined;
  const targetDate = directive.data.target_date as string | undefined;
  const effectiveFrom = directive.data.effective_from as string | undefined;

  if (effectiveFrom) {
    return (
      <div className="kv">
        <Badge tone="warn">Upcoming change</Badge>
        <span className="note">{directive.message}</span>
      </div>
    );
  }

  const dateStr = periodEnd ?? targetDate;

  return (
    <div className="row-2">
      <span style={{ color: "var(--ink-muted)", display: "flex", alignItems: "center" }}>
        <Icon name="clock" size={13} />
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
        {daysLeft !== undefined ? `${daysLeft} days` : ""}
        {dateStr ? ` · ${formatDate(dateStr)}` : ""}
      </span>
    </div>
  );
}

function GoalCard({ view }: { view: GoalView }) {
  const label = goalLabel(view.goal_type, view.progress);

  return (
    <div className="card stack-3">
      {view.data_gap && !view.progress ? (
        <div className="stack-3">
          <span className="eyebrow">{label}</span>
          <div>
            <Badge tone="warn" led>
              Data gap
            </Badge>
          </div>
          <p className="note">{view.data_gap.message}</p>
        </div>
      ) : view.progress ? (
        <GoalMeter goal_type={view.goal_type} progress={view.progress} />
      ) : null}
      {view.deadlines.length > 0 && (
        <div className="stack-3">
          {view.deadlines.map((d, i) => (
            <DeadlineRow key={i} directive={d} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GoalsSection({ directives }: { directives: Directive[] }) {
  const { goals } = groupDirectives(directives);

  return (
    <div className="stack-2">
      <div className="lhead">
        <h4>Goals</h4>
      </div>
      {goals.length === 0 ? (
        <div className="card">
          <p className="note">
            No active goals yet. Ask to set one with propose_goal then confirm_goal.
          </p>
        </div>
      ) : (
        <div className="goals-grid">
          {goals.map((view) => (
            <GoalCard key={view.goal_id} view={view} />
          ))}
        </div>
      )}
    </div>
  );
}
