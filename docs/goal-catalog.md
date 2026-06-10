# Goal Catalog — Authored Domain Corpus

**Status:** Draft for refinement. The authored set of goal types the app recognises, and how each deterministically decomposes into data-bound sub-goals.

**Purpose:** This is the financial domain knowledge, frozen and auditable. Each goal type's decomposition is deterministic — identical every run, never model-generated (see the Goal framework section and design rule 1 in `docs/architecture.md`). Haiku's only role is classifying a user's words onto a goal type here; everything below the classification is fixed app logic.

---

## How to read this

Each goal type follows one template:

- **Maps from** — the kind of intent that classifies onto this type.
- **Needs spec** — the slots the interview must fill before decomposition, with defaults where sensible.
- **Sub-goals** — the components the type decomposes into.
- **Metric bindings** — the deterministic computation each sub-goal binds to. A metric resolves to a value or to null (never captured), and a null fires a data-gap directive.
- **UK edges / notes** — the domain subtleties the decomposition must encode.

Metric names are shared with `docs/architecture.md` and `docs/end-state-flows.md`. Keep them identical across all three.

The dated values the UK-edges sections reference — the safe-withdrawal-rate default, the pension access age, the ISA and pension allowances — are not hardcoded here. They resolve from the app-owned `tax_constants` reference, dated and status-tagged, and are injected at advice and briefing time. See the Domain rule data section in `docs/architecture.md`.

---

## `fire` — financial independence, retire early

**Maps from.** "I want to retire early", "be financially independent", "stop needing to work by 50".

**Needs spec.**

| Slot | Default |
|---|---|
| Target annual spend (pence) | none — must ask |
| Safe-withdrawal-rate | 4 percent |
| Current age | none — must ask |
| Target retirement age | none — must ask |

**Sub-goals.**

| Sub-goal | Definition |
|---|---|
| `target_number` | Target portfolio = target annual spend / safe-withdrawal-rate. |
| `bridge_fund` | Spending across the gap between target retirement age and pension access age: annual spend x (pension access age - target retirement age). Zero if retiring at or after pension access age. |
| `contribution_gap` | Required monthly contribution to reach `target_number` by the target age, versus actual contributions. |

**Metric bindings.**

| Sub-goal | Metric |
|---|---|
| `target_number` | `invested_assets` (and pension pot) versus the computed target. |
| `bridge_fund` | `liquid_savings` plus accessible ISA/GIA holdings versus the computed bridge requirement. |
| `contribution_gap` | `contribution_rate` derived from income events and pension contributions. |

**UK edges / notes.** Pension access age is 57 from 2028. Retiring before it means the pension pot cannot fund the early years, so `bridge_fund` must be held in accessible ISA/GIA rather than pension. This is the edge that separates `fire` from `retirement`.

**Implemented formula.** Needs spec: `target_annual_spend_pence`, `safe_withdrawal_rate_bps` (default 400 = 4%), `target_retirement_age`, `date_of_birth` (validated at the boundary; age is derived from the DOB at briefing time, never frozen in the goal row). Decomposes to three sub-goals. `pot_progress` binds to `projected_invested_assets`: `invested_assets` (pension pot via `pension_values`, ISA balances, and non-property `holdings × asset_prices`; cash excluded) projected in real terms by year-by-year integer-pence compounding at the 3% real return in `server/goals/assumptions.ts`, plus annualised employee-plus-employer pension contributions (`income_events`), over the whole years to `target_retirement_age`; the FIRE number is `target_annual_spend / SWR`. `contribution_gap` binds to `contribution_rate`. `bridge_fund` binds to `bridge_fund`: accessible assets (cash + ISA + non-property holdings, everything except the locked pension) against `annual_spend × (pension_access_age − target_retirement_age)`, zero when retiring at or after the access age resolved from `tax_constants`. Cash funds the bridge but is excluded from the safe-withdrawal sufficiency total and never grown at the investment return; ISA and holdings serve both the sufficiency and the bridge tests, never summed. Observation-only; the assumptions surface in the briefing's `retirement_projection` block, which also reports invested assets, cash, and total drawable wealth.

**Shared resources / contention.** Claims `pension` plus the full liquid pool (`current`/`savings`/`isa`), because the bridge draws on accessible savings. It therefore contends with `emergency_fund`/`house_deposit` over the liquid accounts and with `retirement` over the pension pot.

---

## `house_deposit`

**Maps from.** "Save for a house", "get a deposit together", "buy a flat in a few years".

**Needs spec.**

| Slot | Default |
|---|---|
| Target deposit amount (pence) | none — must ask |
| Horizon (target date) | none — must ask |

**Sub-goals.**

| Sub-goal | Definition |
|---|---|
| `deposit_progress` | Accumulated savings versus the target deposit by the horizon. |

**Metric bindings.**

| Sub-goal | Metric |
|---|---|
| `deposit_progress` | `liquid_savings`. |

**UK edges / notes.** A Lifetime ISA adds a 25 percent government bonus on contributions up to the annual limit for a first home under the price cap — flag eligibility where it materially changes the required contribution. LISA funds are otherwise penalised on non-qualifying withdrawal.

**Implemented formula.** Needs spec: `target_amount_pence` (no default — must ask) and `target_date` (YYYY-MM-DD, no default), validated at the boundary. The `deposit_progress` sub-goal binds to `house_deposit_progress`, which reuses `liquid_savings` (sum of the latest balance per `current`/`savings`/`isa` account, LOCF). The progress directive reports saved versus target and percent; a deadline directive reports days to `target_date`. Unresolved (data-gap) when no liquid balances exist.

**Shared resources / contention.** Claims the full liquid pool (`current`, `savings`, `isa`) by default, so it contends with `emergency_fund` over the same money and with `isa_max` over the ISA accounts. The briefing emits a `contention` directive over the shared accounts; resolving the conflict (which goal the money serves) is advice, not an observation. Earmarks that narrow a goal to specific accounts are deferred.

---

## `emergency_fund`

**Maps from.** "Build a safety net", "have a few months' expenses set aside", "rainy-day fund".

**Needs spec.**

| Slot | Default |
|---|---|
| Months of cover | 3 to 6 |

**Sub-goals.**

| Sub-goal | Definition |
|---|---|
| `cover_progress` | Accessible savings expressed as months of outgoings, versus the target months. |

**Metric bindings.**

| Sub-goal | Metric |
|---|---|
| `cover_progress` | `emergency_fund_months` — `liquid_savings` divided by average monthly outgoings. |

**UK edges / notes.** Cover is measured against essential monthly outgoings, not gross spend. Funds must be genuinely accessible — instant or near-instant access — so locked products do not count toward the metric.

**Implemented formula.** `liquid_savings` = sum of the latest balance per account of type `current`, `savings`, or `isa` (LOCF as of the query date). Average monthly outgoings = mean of monthly transaction outflow over the trailing 12 months, across months that had any outflow, excluding internal transfers (`is_internal = 1`) and savings/investing contributions (`category = 'savings'`) since neither is a living expense. `emergency_fund_months` = `liquid_savings` / average monthly outgoings. The metric is unresolved (fires a data-gap directive) when there are no liquid balances or no spending transactions.

**Shared resources / contention.** Claims the full liquid pool (`current`, `savings`, `isa`). It contends with `house_deposit` over the whole pool and with `isa_max` over the ISA accounts; the briefing emits a `contention` directive over the shared accounts. The same money backing the safety net cannot also fund a deposit in full — that is the observation. Choosing which goal it serves is advice.

---

## `isa_max`

**Maps from.** "Use up my ISA allowance", "max my ISA this year".

**Needs spec.**

| Slot | Default |
|---|---|
| Tax year | current tax year |

**Sub-goals.**

| Sub-goal | Definition |
|---|---|
| `allowance_progress` | ISA contributions in the tax year versus the annual allowance. |

**Metric bindings.**

| Sub-goal | Metric |
|---|---|
| `allowance_progress` | `isa_allowance_remaining` — annual allowance minus contributions since the tax year `starts_on`, anchored to `tax_periods`. |

**UK edges / notes.** Anchor to the UK tax year (April 6 to April 5) via `tax_periods`, never the calendar year. The annual allowance figure is itself a dated fact and must track the year in scope. The directive carries days remaining in the tax year, since the allowance does not carry forward.

**Implemented formula.** Contributions = sum of inflow transactions (positive `amount_pence`) to accounts of type `isa` within the tax-year window resolved from `tax_periods`. `isa_allowance_remaining` = annual allowance minus contributions. The metric is unresolved (fires a data-gap directive) when no ISA account exists. The deadline directive reports days from the query date to the tax-year `ends_on`.

**Stopgap.** The annual allowance is currently a hardcoded constant (`ISA_ANNUAL_ALLOWANCE_PENCE`, £20,000) in the goals catalog module, pending the dated, status-tagged `tax_constants` reference described in `docs/architecture.md`. Precise contribution modelling (distinguishing deposits from growth) is also deferred; inflow transactions to the ISA account are the current approximation.

**Shared resources / contention.** Claims only `isa` accounts. It therefore contends with any goal that claims the liquid pool (`emergency_fund`, `house_deposit`) over the ISA accounts specifically — the ISA balance counted toward the safety net is the same balance whose allowance this goal tracks. The briefing emits a `contention` directive over the shared ISA accounts.

---

## `debt_payoff`

**Status.** Catalogued but not implemented — the classifier knows the type, but no decomposition or metric exists in `server/goals/`; confirming a `debt_payoff` goal is refused. The only authored type in this state.

**Maps from.** "Clear my debts", "pay off the credit card", "be debt-free".

**Needs spec.**

| Slot | Default |
|---|---|
| Target debt(s) | none — must ask which |
| Horizon (target date) | none — optional |

**Sub-goals.**

| Sub-goal | Definition |
|---|---|
| `balance_progress` | Outstanding balance on the targeted debt(s) versus zero, trended. |

**Metric bindings.**

| Sub-goal | Metric |
|---|---|
| `balance_progress` | `outstanding_debt` across the targeted liabilities. |

**UK edges / notes.** Where multiple debts exist, the highest-interest-first (avalanche) ordering minimises total interest; surface it as an observation, not a directive to reorder payments — ordering advice sits behind the advice gate.

---

## `retirement`

**Maps from.** "Be comfortable in retirement", "retire at state pension age", "have enough for later life".

**Needs spec.**

| Slot | Default |
|---|---|
| Target annual retirement income (pence) | none — must ask |
| Retirement age | none — must ask |

**Sub-goals.**

| Sub-goal | Definition |
|---|---|
| `pot_progress` | Projected pension pot at the retirement age versus the pot needed to fund the target income. |
| `contribution_gap` | Required contribution to close the gap, versus actual. |

**Metric bindings.**

| Sub-goal | Metric |
|---|---|
| `pot_progress` | `projected_pension_pot`. |
| `contribution_gap` | `contribution_rate`. |

**UK edges / notes.** Distinguished from `fire` by the absence of an early-access bridge — retirement at or after pension access age can draw the pension directly, so no `bridge_fund` sub-goal. Pension and ISA annual-allowance headroom inform `contribution_gap` but do not, on their own, cross into advice.

**Implemented formula.** Needs spec: `target_annual_income_pence`, `retirement_age`, `date_of_birth` (validated at the boundary; age is derived from the DOB at briefing time). Decomposes to `pot_progress` (`projected_pension_pot`) and `contribution_gap` (`contribution_rate`). The projected pot is real-terms year-by-year integer-pence compounding at the 3% real return from the current pot (`pension_values`, LOCF) plus annualised employee-plus-employer contributions (`income_events`) to the retirement age; the pot needed is `target_annual_income / SWR` (4% default). No `bridge_fund`, since the pension can be drawn directly at or after access age. Observation-only; the assumptions surface in the briefing's `retirement_projection` block, with State Pension excluded (it would lower the pot needed).

**Shared resources / contention.** Claims `pension` only, so it contends with `fire` over the pot but not with the liquid-pool goals.
