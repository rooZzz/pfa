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

---

## `debt_payoff`

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
