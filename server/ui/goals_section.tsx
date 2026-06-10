import { Badge, EmptyState, Icon, Meter } from "./components.js";
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
  progress: Directive[];
  deadlines: Directive[];
  data_gaps: Directive[];
};

function goalLabel(goal_type: string, progress: Directive | null): string {
  if (goal_type === "emergency_fund") return "Emergency Fund";
  if (goal_type === "house_deposit") return "House Deposit";
  if (goal_type === "retirement") return "Retirement";
  if (goal_type === "fire") return "FIRE";
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
        progress: [],
        deadlines: [],
        data_gaps: [],
      });
    }
    const view = map.get(d.goal_id)!;
    if (d.kind === "progress") view.progress.push(d);
    else if (d.kind === "deadline") view.deadlines.push(d);
    else if (d.kind === "data_gap") view.data_gaps.push(d);
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

function ProjectionMeter({
  progress,
  contributionPence,
}: {
  progress: Directive;
  contributionPence: number | null;
}) {
  const projected = Number(progress.data.projected_pot_pence);
  const needed = Number(progress.data.pot_needed_pence);
  const percent = Number(progress.data.percent);
  const targetAge = Number(progress.data.target_age);
  const pct = Math.min(100, percent);
  const name = progress.goal_type === "fire" ? "FIRE number" : "Retirement pot";
  const subParts = [`projected by age ${targetAge}`, `${percent}% funded`];
  if (contributionPence != null && contributionPence > 0) {
    subParts.push(`${formatGbpk(contributionPence)}/yr pension`);
  }
  return (
    <Meter
      name={name}
      value={`${formatGbpk(projected)} / ${formatGbpk(needed)}`}
      pct={pct}
      tone={pct >= 100 ? "pos" : undefined}
      sub={subParts.join(" · ")}
    />
  );
}

function BridgeFundMeter({ progress }: { progress: Directive }) {
  const bridgeYears = Number(progress.data.bridge_years);
  const accessAge = Number(progress.data.pension_access_age);
  if (bridgeYears === 0) {
    return (
      <Meter
        name="Bridge fund"
        value="Not needed"
        pct={100}
        tone="pos"
        sub={`retiring at or after pension access (age ${accessAge})`}
      />
    );
  }
  const accessible = Number(progress.data.accessible_pence);
  const need = Number(progress.data.bridge_need_pence);
  const shortfall = Number(progress.data.bridge_shortfall_pence);
  const pct = need > 0 ? Math.min(100, (accessible / need) * 100) : 100;
  const subParts = [`${bridgeYears}y to age ${accessAge}`];
  if (shortfall > 0) subParts.push(`${formatGbpk(shortfall)} short`);
  return (
    <Meter
      name="Bridge fund"
      value={`${formatGbpk(accessible)} / ${formatGbpk(need)}`}
      pct={pct}
      tone={accessible >= need ? "pos" : undefined}
      sub={subParts.join(" · ")}
    />
  );
}

function ProgressBlock({
  directive,
  contributionPence,
}: {
  directive: Directive;
  contributionPence: number | null;
}) {
  const sub = directive.sub_goal;
  if (sub === "cover_progress") return <EmergencyFundMeter progress={directive} />;
  if (sub === "allowance_progress") return <IsaMeter progress={directive} />;
  if (sub === "deposit_progress") return <HouseDepositMeter progress={directive} />;
  if (sub === "pot_progress")
    return <ProjectionMeter progress={directive} contributionPence={contributionPence} />;
  if (sub === "bridge_fund") return <BridgeFundMeter progress={directive} />;
  return <p className="note">{directive.message}</p>;
}

function DeadlineRow({ directive }: { directive: Directive }) {
  const daysLeft = directive.data.days_left;
  const years = directive.data.years as number | undefined;
  const periodEnd = directive.data.period_end as string | undefined;
  const targetDate = directive.data.target_date as string | undefined;
  const retirementDate = directive.data.retirement_date as string | undefined;
  const effectiveFrom = directive.data.effective_from as string | undefined;

  if (effectiveFrom) {
    return (
      <div className="kv">
        <Badge tone="warn">Upcoming change</Badge>
        <span className="note">{directive.message}</span>
      </div>
    );
  }

  const dateStr = periodEnd ?? targetDate ?? retirementDate;
  const leftText =
    daysLeft !== undefined
      ? `${daysLeft} days`
      : years !== undefined
        ? `${years} years`
        : "";

  return (
    <div className="row-2 deadline">
      <span className="deadline-ico">
        <Icon name="clock" size={13} />
      </span>
      <span>
        {leftText}
        {dateStr ? ` · ${formatDate(dateStr)}` : ""}
      </span>
    </div>
  );
}

function GoalCard({ view }: { view: GoalView }) {
  const label = goalLabel(view.goal_type, view.progress[0] ?? null);
  const contribution = view.progress.find((d) => d.sub_goal === "contribution_gap");
  const contributionPence = contribution
    ? Number(contribution.data.annual_contribution_pence)
    : null;
  const progress = view.progress.filter((d) => d.sub_goal !== "contribution_gap");

  return (
    <div className="card stack-3">
      {progress.map((d, i) => (
        <ProgressBlock
          key={`p${i}`}
          directive={d}
          contributionPence={contributionPence}
        />
      ))}
      {view.data_gaps.map((d, i) => (
        <div key={`g${i}`} className="stack-3">
          {progress.length === 0 && i === 0 && <span className="eyebrow">{label}</span>}
          <div>
            <Badge tone="warn" led>
              Data gap
            </Badge>
          </div>
          <p className="note">{d.message}</p>
        </div>
      ))}
      {view.deadlines.length > 0 && (
        <div className="stack-3">
          {view.deadlines.map((d, i) => (
            <DeadlineRow key={`d${i}`} directive={d} />
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
        <EmptyState>
          No active goals yet. Ask to set one with propose_goal then confirm_goal.
        </EmptyState>
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
