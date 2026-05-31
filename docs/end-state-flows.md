# End-State Flow Map

**Status:** Draft for refinement. Defines the finished-app target the staged plan derives from. Not a description of what exists today.

**Purpose:** We have been planning stages forward from the current code, so every new concern reopens the stage definitions. This document fixes the destination. Stages are then derived backward from it. Capabilities are not invented per stage — they fall out of the flows below.

---

## The flows

Three operational flows move and maintain data. Five capability flows turn that data into value. Goals and the briefing (Flow 8) capture intent and push a complete grounded observation set; they underpin insight and advice. Advice (Flow 7) is new, dangerous, and gated.

| # | Flow | Kind | One line |
|---|---|---|---|
| 1 | Ingest | Operational | Any document, value, connector, or goal becomes auditable, structured data or intent |
| 2 | Edit | Operational | Any committed source can be corrected or removed without losing history |
| 3 | Query | Operational | Any question becomes a grounded answer with provenance |
| 4 | Net worth | Capability | What I own, realised vs contingent, point-in-time and trended |
| 5 | Cashflow | Capability | What comes in and goes out, tax-aware, historic and projected |
| 6 | Insight | Capability | Facts surfaced from my own data, no judgement attached |
| 7 | Advice | Capability | Sound planning guidance grounded in my data and UK rules |
| 8 | Goals and briefing | Capability | What I am aiming for, and a complete grounded observation set pushed from it |

Each flow below is specified across six dimensions: trigger, surface, what the model does, what is read or written, what the user sees, and how failure and review are handled.

Two of these are easy to conflate, so they are defined precisely to keep this document at the level of intent rather than implementation:

- **Trigger** is the user's intent that starts the flow, in the user's own terms. It is independent of how that intent is served — which tool fires, or whether a widget renders, is downstream and not part of the trigger. There are only two trigger classes across every flow: the user expresses intent in conversation, or the user acts inside an already-open widget.
- **Surface** is where interaction happens. Conversation is the universal entry point. Some flows additionally have dedicated widgets. Whether a given response renders as an inline answer or as a widget is a runtime orchestration decision by the harness, not a fixed property of the flow.

---

## Flow 1 — Ingest

Three source types, three trust levels, distinct entry surfaces, one canonical destination.

### Uploads (low trust)

**Trigger.** The user has a single document to capture.

**Constraint — one source, one document at a time.** The upload path accepts a single file of a single type per cycle. No multi-file uploads, no multi-type batches. Each document gets its own parse, its own review, its own confirmation. This keeps extraction unambiguous and the audit trail one-to-one. Bulk historical backfill (loading a year of payslips) is explicitly out of scope — deferred, not designed for.

**Surface.** `ui://upload` is the sole entry point — the file enters through the widget, never as a chat attachment or a file path. `ui://review` for confirmation.

**How the file reaches the server.** The file enters the sandboxed iframe directly via a standard file input or drag-and-drop (works under `sandbox="allow-scripts"`; no same-origin needed). The widget reads it client-side with `FileReader`, base64-encodes it, and calls a content-based server tool — `ingest_document({ file_base64, filename, mime_type, document_type })` — via `app.callServerTool`. No file path is ever passed; the file is never a chat attachment and is never model-visible. The bytes transit the host process only as the arguments of that tool call (the sole iframe-to-server channel by design — there is no direct socket and no local web server).

**What the model does.**
- Type resolution. If the user has indicated the type in the widget, use it. Otherwise `classify_document` (Haiku) returns a type from a closed enum plus a confidence score. Low confidence or "not a financial document" routes to a prompt, never a guess.
- Parse. A parser registry maps `document_type` to a single-purpose parser (payslip, equity vest schedule, pension statement, bank statement, mortgage statement, asset/crypto holding). Each parser returns typed financial primitives plus a long-tail JSON payload for attributes the schema does not model.

**Read / written.** Parsed rows land in a staging buffer. On confirmation: a `documents` row (file bytes written to the documents directory, content-hashed) plus event/snapshot rows carrying `source_id`.

**What the user sees.** `ui://review` shows staged rows with the source document alongside, for confirm/edit/reject. On commit, an acknowledgement of what was written and where it came from.

**Failure / review.** Human review is mandatory. Parse failure fails loudly with a remediation message. Classification uncertainty asks. Rejection at review discards; nothing is written.

**Known risk to spike.** Large files base64-encoded as a tool-call argument cross postMessage and then stdio. Validate the round-trip with a real multi-megabyte payslip PDF before committing the design.

### Manual entry (medium trust)

**Trigger.** The user wants to record a value directly ("my pension is 42,000 as of today").

**Surface.** Conversation.

**What the model does.** Picks the right tool from a fanned set, one per series — `record_account_balance`, `record_pension_value`, `record_mortgage_balance`, `record_asset_holding`, `record_asset_price`, `record_equity_grant`, `record_vesting_event`. Each captures the raw input, writes a system-generated JSON file as the source document, ensures its reference row (account, asset, mortgage, grant) if needed, and writes the typed event/snapshot row — all in one transaction.

Asset entry is a two-step pair: `record_asset_holding` records inventory (quantity, effective date); `record_asset_price` records valuation (per-unit price, as-of timestamp, source). Refreshing the price calls `record_asset_price` again without touching the holding. `refresh_asset_price` dispatches on `assets.price_source` — for `manual` it instructs the user; future connectors implement the other cases.

The fan-out (rather than a single dispatching tool) keeps each tool's argument schema tight and unambiguous: the LLM picks the right tool from the conversation rather than threading a generic payload through a router. Shared helpers (`writeManualDocument`, `ensureAccount`, `ensureAsset`) live in `references.ts` so the per-series tools stay thin.

**Read / written.** A `documents` row (source_type `manual`, the JSON file) plus the reference row (idempotent) plus the typed data row with `source_id`.

**What the user sees.** Chat acknowledgement naming the series, the value, the date, and the document/reference IDs.

**Failure / review.** No review step — the user is the source. The JSON file preserves the raw input as entered, as the audit trail.

### Connectors (high trust)

**Trigger.** The user wants an external source to feed in automatically. Two phases: setup is a deliberate user action; sync is autonomous thereafter.

**Surface — setup uses specialised UI, not file drop.** `ui://connectors` captures connector-specific configuration through purpose-built components: an API key field for Monzo, a wallet address field for Ethereum, plus enable/disable and schedule. This is a different interaction from the upload drop zone and must not be modelled as one.

**What the model does.** After setup, a background OS process (launchd) runs independently of Claude Desktop, calling the connector API on schedule and writing structured rows directly.

**Read / written.** Connector rows `INSERT OR IGNORE` on `external_id` (idempotent). Each run writes a connector run record to `documents`.

**What the user sees.** Setup confirmation in `ui://connectors`; thereafter data simply appears. The user does not touch the connector again unless reconfiguring.

**Failure / review.** No review step — structured, high trust, deduplicated. Setup validation (bad API key, malformed wallet address) fails loudly at the `ui://connectors` boundary.

### Goal capture (intent, not data)

**Trigger.** The user states what they are aiming for ("I want to retire early", "save for a house deposit"). A financial adviser asks this first, so onboarding elicits goals before or alongside the first data.

**Surface.** Conversation.

**What the model does.** Haiku classifies the user's words onto a goal type from the catalog (`docs/goal-catalog.md`). For a compound type the app returns a needs spec — the slots that must be filled — and the harness conducts the interview to fill them. On confirmation the app deterministically decomposes the goal type into sub-goals bound to metrics. Decomposition is authored, never model-generated.

**Read / written.** A goal record: goal type, confirmed slots, derived sub-goals and metric bindings, and the verbatim utterance as provenance. No financial data row — a goal is intent, captured separately from the data it will be measured against.

**What the user sees.** Confirmation of the goal as understood, the slots captured, and what data will be needed to track it.

**Failure / review.** Text that maps to no goal type is pushed back for clarification, never guessed — an unmappable goal is inert. The planning and briefing mechanics that act on a captured goal are Flow 8.

---

## Flow 2 — Edit

Edit is not a separate surface. It folds into the manual-entry path: a correction is a new manual observation that supersedes a prior one. There is no `ui://sources` browser. Editing must never destroy history — a correction is a new fact about an old fact.

**Trigger.** The user knows a committed value is wrong, or wants to remove a source ("the pension figure from that March statement should be 190190").

**Surface.** Conversation. (A read-only browse of sources may be added later for convenience, but is not required and never mutates.)

**What the model does.**
- Extract intent. Parse the instruction into a target series, the new value, and whether this corrects a past observation or records a new value. "The March statement should be X" corrects the past observation — the corrected row keeps the original `valid_from`. "My pension is now X" is a fresh entry with `valid_from = today` and is ordinary manual entry, not an edit.
- Locate and confirm. Read (via the query pipeline) to resolve the target to a specific row, then confirm it with the user in chat: "correcting the 2026-03-31 pension snapshot, 185,000 to 190,190?"
- On confirmation, write an audit JSON document (source_type `manual`) capturing the raw instruction, then apply the correction via the fixed correction primitive.

**The correction primitive — never LLM-generated mutation SQL.** The model extracts intent; a deterministic code path performs the write. Snapshot: close the old row (`valid_to = today`), insert the corrected row preserving the original `valid_from`, `source_id` pointing at the audit document. Event: a superseding or reversing entry, never an in-place mutation. Removal: a superseding tombstone entry, not a hard delete.

**Read / written.** Reads to locate the target (DuckDB, read-only). Writes the audit document plus correction rows through the write store. Never issues `UPDATE` or `DELETE` against committed data.

**What the user sees.** The confirmation prompt resolving exactly which row changes, then an acknowledgement. Full correction history remains queryable.

**Failure / review.** Target ambiguity asks, never guesses — a wrong target on a write corrupts the canonical store, so disambiguation is mandatory. The read pipeline stays read-only; the only write channel is the constrained correction primitive.

---

## Flow 3 — Query

**Trigger.** The user wants an answer about their finances.

**Surface.** Conversation. Dashboards (`ui://net_worth`, `ui://cashflow`) are query consumers, not the query surface.

**What the model does.** `query_natural_language` routes the question:
- SQL-answerable (aggregation, trend, balances, tax-year sums) → Haiku text-to-SQL against `schema_catalog.md` + DDL → DuckDB executes.
- Reasoning-required (PAYE band arithmetic, projections, "what if") → tool returns raw data, Claude computes in its reasoning layer.
- Not answerable from stored data → say so plainly. Do not fabricate SQL or numbers.

**Read / written.** Read-only over the SQLite file via DuckDB. No writes.

**What the user sees.** The answer, carrying provenance (which documents the numbers came from) and staleness (`recorded_at` for any snapshot-derived value). "Your pension is 42,000" without a date is a misleading answer and is not permitted.

**Failure / review.** Generated SQL that errors is validated and retried, not silently swallowed. Ambiguous questions are clarified before answering.

---

## Flow 4 — Net worth

**Trigger.** The user wants to know what they are worth, now or over time.

**Surface.** Conversation for one-line answers; `ui://net_worth` for the dashboard rendering.

**What the model does.** Sums snapshot series via LOCF at a chosen date. Splits the picture into two never-blended layers: realised (accounts, vested holdings, pension pots, property net of mortgage) and contingent (unvested equity, valued by a method still to be decided). Produces point-in-time, trend, and forward projection.

**Read / written.** Reads balances, pension values, asset values, mortgage balances, equity grants and vesting events. No writes.

**What the user sees.** A breakdown by account, asset, and liability; contingent equity shown distinctly and labelled as not-yet-owned; trend over time; staleness per line; a projection trajectory.

**Failure / review.** Stale or missing series are shown as last-observed with their date, never interpolated. Unknown is distinguished from zero.

---

## Flow 5 — Cashflow and budgeting

**Trigger.** The user wants to understand money in versus money out, historic or projected.

**Surface.** Conversation for specifics; `ui://cashflow` for the dashboard rendering.

**What the model does.** Combines income events and transactions, anchored to the UK tax year via `tax_periods`. Aware of PAYE, NI, employee and employer pension contributions, salary sacrifice, and ISA allowance consumption. Models equity vesting events as projected income spikes with an estimated tax liability alongside. Compares budget to actual.

**Income is sourced once, from the bank feed.** Money in and out comes from `transactions` — the salary credit, rent, and any other income all land there as credits, each counted exactly once. Payslips (`income_events`) are not an additive income line; they are the tax decomposition of the salary credit (gross, PAYE, NI, employee/employer pension) and feed the tax-year and allowance logic. Summing payslip net pay together with transaction inflows would double-count salary, since the same money already appears as a bank credit. This assumes the salary-receiving account is connected; if a payslip has no matching credit in any connected account, that is a data-gap directive (Flow 8), not a silent fallback.

**Gross-to-net waterfall — every pound shown once, per denominator.** There are two denominators and each view states which it uses. Denominator A is gross earnings, the payslip's domain: a waterfall of Gross − pre-tax deductions − PAYE − NI − post-tax deductions = Net pay. Denominator B is cash in the account, the bank feed's domain: net salary credit plus other credits, less spending, less savings. The two meet at exactly one point — net pay equals the salary credit. Post-tax outgoings (student loan, post-tax pension, share-save) are outflows of *earnings*, shown as a leg of the waterfall in denominator A; they are never bank spending categories in denominator B, because they are deducted before the money lands and never become a spendable credit. Pension contributions are shown as deferred, not spent — visually distinct from tax, which is gone. Employer pension is deferred compensation context (total reward), never added to income totals. The line-item `section` (payment vs deduction) is what resolves salary-sacrifice ordering deterministically, so the waterfall is reconstructed, never re-parsed from description strings. Any unexplained gross-to-net gap is shown as a labelled "other deductions" leg, never hidden. The cashflow surface renders the current period's waterfall; longitudinal questions — gross over time, the tax-code timeline, year-to-date PAYE/NI — are a different question and belong to a deferred earnings surface, not this in-versus-out frame.

**Read / written.** Reads income events, transactions, person profile, equity vesting events, tax periods. No writes.

**What the user sees.** Historic cashflow by category, projected cashflow including vesting spikes, tax-year-anchored allowance consumption (ISA, pension annual allowance).

**Failure / review.** Projections state their assumptions. Tax arithmetic is computed in the reasoning layer, not encoded as fragile SQL.

---

## Flow 6 — Insight

**Trigger.** The user wants to know what is notable in their data — or the system surfaces it unprompted when the data warrants it.

**Surface.** Conversation, and inline on dashboards.

**What the model does.** States facts grounded entirely in stored data. "ISA 60 percent funded, 47 days left in the tax year." "Tax code changed from 1257L to 0T in September." No judgement, no recommendation. This is the trust-building layer — its accuracy over time is what gates Flow 7.

**Read / written.** Reads across all stores. No writes.

**What the user sees.** Plain factual observations, each traceable to its source data.

**Failure / review.** An observation that cannot be fully grounded is not surfaced. No speculation dressed as fact.

---

## Flow 7 — Advice (gated end state)

**Trigger.** The user faces a financial planning decision — "should I overpay the mortgage or add to the ISA," "when is it most tax-efficient to sell vested shares," "am I on track for retirement."

**Surface.** Conversation, with the working shown.

**What the model does.** Grounds guidance in the user's actual data plus UK tax and financial domain logic, and produces sound, conservative planning advice: pension annual-allowance headroom, ISA optimisation, overpay-versus-invest, tax-efficient timing of equity disposals against CGT. The UK tax constants it applies — allowances, rates, bands — are supplied by the app for the tax year in scope, never sourced from the model's own training. The harness applies and frames the rules; the figures are injected.

**Read / written.** Reads across all stores plus the projection engine. No writes, and critically no autonomous action — advice is surfaced; the user decides and acts.

**What the user sees.** The recommendation, the data it rests on, the assumptions made, and the calculation. Advice is auditable in the same way a stored number is.

**Guardrails — this is the dangerous flow.**
- Trust gate. Advice is locked until the insight layer has demonstrated sustained accuracy. The gating metric and threshold are an open decision.
- Show the working, always. No black-box recommendation.
- Surface staleness and confidence. Advice built on a six-month-old balance says so.
- Conservative and reversible bias. Prefer guidance that is hard to regret.
- Hard boundary. Planning guidance grounded in the user's own numbers and UK rules — not regulated financial advice, not market timing, not product selection. Framed explicitly as such.

This does not contradict the "observations only" decision in the log — it is the state that decision was reserving the door for, once trust is established. The line is precise: a directive firing is an observation (Flow 6 and Flow 8, permitted today); ranking options — overpay versus invest — is advice, and stays behind this gate.

The gate is enforced today via server `instructions` and tool descriptions (best-effort behavioural nudge — MAY-injected, model-variable). This is not a hard guarantee. True enforcement requires handler-side gating or removing model-facing raw-data tools; deferred. See the decision log in `docs/architecture.md`.

---

## Flow 8 — Goals and briefing

Goal capture (Flow 1) records what the user is aiming for. This flow turns goals plus data into a complete, grounded observation set that underpins insight (Flow 6) and advice (Flow 7).

**Trigger.** The user asks how they are tracking ("am I on track?"), or the system surfaces a briefing unprompted when the data warrants it.

**Surface.** Conversation, and inline on dashboards.

**What the model does.** The app — not the harness — evaluates every directive across all active goals against current data and pushes the complete observation set to the harness. The harness prioritises and frames; it never decides what to query. Coverage is the app's responsibility, framing is the harness's. A directive whose metric cannot resolve (no data captured yet) fires as a data-gap directive, which becomes the next capture prompt.

**Read / written.** Reads goals, metric definitions, and all data stores. No writes. Whether briefings are persisted is an open decision.

**What the user sees.** A prioritised set of grounded observations ("ISA 60 percent funded, 47 days left"; "house deposit goal set, no savings account linked"; "ISA allowance drops on [date], 73 days away — proposed, subject to legislation"), each traceable to its data or named as a gap. Deadline directives fire from pending tax constants the same way as from the tax-year boundary, and a directive on an announced-not-enacted change carries its certainty. No ranking of options — that is advice, Flow 7.

**Failure / review.** An observation that cannot be fully grounded is not surfaced. The briefing pushes the full set rather than a model-chosen subset, so a relevant gap is never silently omitted because the model did not think to look.

---

## Capabilities implied by the flows

These are consequences of the flows above, not independent features. Each one exists because a flow requires it.

| Capability | Required by | Notes |
|---|---|---|
| Widget-driven upload | Ingest | File enters the `ui://upload` iframe, read client-side, sent as base64 via `app.callServerTool`. No path, no chat attachment. |
| Content-based `ingest_document` | Ingest | Accepts `file_base64` + filename + mime + type, not a path. Replaces the current path-based shape. |
| Parser registry / dispatch | Ingest | Needed the moment a second parser exists. Routes `document_type` to a parser. |
| Per-type parsers | Ingest | Payslip, equity, pension, statement, mortgage, asset. Each single-purpose. |
| `classify_document` (Haiku) | Ingest | Only the contextless `ui://upload` path needs it. Confidence-gated. |
| Staging + `ui://review` | Ingest, Edit | Mandatory human confirmation for uploads; edit mode for corrections. |
| `ui://connectors` setup components | Ingest | Specialised inputs (API key, wallet address), distinct from the upload drop zone. |
| Long-tail JSON payload | Ingest, all stores | The flex layer. Typed spine for arithmetic; JSON for the unmodelled tail. |
| Equity entities | Ingest, net worth, cashflow | Grant (reference) + vesting event (event). Typed primitives + payload. |
| Correction intent extraction | Edit | LLM parses the NL correction into target, new value, and correct-past vs record-new. |
| Correction primitive (code, not LLM SQL) | Edit | Deterministic close-and-reinsert for snapshots; superseding entries for events; tombstone for removal. No in-place UPDATE/DELETE. |
| Query router | Query | SQL vs reasoning vs not-answerable. |
| Living `schema_catalog.md` | Query | The primary accuracy lever for text-to-SQL. |
| Projection engine | Net worth, cashflow, advice | Forward modelling shared by three flows. |
| Provenance + staleness surfacing | Query, net worth, cashflow, advice | A cross-cutting invariant, not a feature. |
| Trust / accuracy tracking | Insight, advice | Measures whether the system has earned the right to advise. |
| Goal catalog (authored) | Goals, briefing | Finite goal types and their frozen, deterministic decompositions. The domain corpus in `docs/goal-catalog.md`. |
| Goal classification (Haiku) | Goals | Maps free text onto a goal type; unmappable text is pushed back, not guessed. |
| Needs spec + interview | Goals | App returns the slots a compound goal needs; the harness fills them. |
| Deterministic decomposition | Goals | Goal type to sub-goals to metric bindings. Authored code, never model-generated. |
| Metric definitions | Goals, briefing | Computations that bind sub-goals to data; resolve to a value or null. |
| Directive engine | Briefing, insight, advice | Evaluates metrics against targets; fires observations, including data-gap directives. |
| Briefing push contract | Briefing, insight, advice | App pushes the complete observation set; the harness never chooses what to query. |
| Verbatim utterance provenance | Goals | Original words stored on the goal for audit and harness framing; never a data source. |
| Tax-constants reference (dated, status-tagged) | Advice, briefing | App-owned `tax_constants`, sibling of `tax_periods`; `enacted` vs `announced`, temporally versioned. Injected per call, never recalled. Human-curated on the fiscal cadence. |

---

## Decided vs open

**Decided (locked in `docs/architecture.md` and the decision log, plus this round).** Local stdio MCP server as the app; Claude Desktop as harness; SQLite write store + DuckDB read; event/snapshot table patterns; `documents` as universal source anchor; integer amounts, explicit currency, UTC; `tax_periods` for UK tax year; mandatory human review for uploads; connector dedup via `external_id`; connector setup through specialised `ui://connectors` components; uploads are one-source, one-document at a time (no multi-file, no multi-type, bulk backfill deferred); uploads enter through the `ui://upload` widget only, sent to the server as base64 via `app.callServerTool` (no file path, no chat attachment, never model-visible); `ingest_document` is content-based, not path-based; edits fold into the manual-entry path (no `ui://sources` surface) — the LLM extracts correction intent, a deterministic primitive performs close-and-reinsert (snapshots), superseding entries (events), or a tombstone (removal); never an in-place UPDATE or DELETE, never LLM-generated mutation SQL; the read pipeline stays read-only; goals are elicited first (goals-first onboarding) and captured as intent separate from data; the goal pipeline is classify (Haiku) then needs spec then interview (harness) then deterministic decomposition (app); goal-type decomposition into sub-goals is authored and frozen, never model-generated; metrics bind to definitions that resolve to a value or null, and a null fires a data-gap directive; the briefing pushes the complete observation set rather than the harness pulling a subset; the verbatim utterance is stored as provenance and harness framing context, never a data source; the advice gate is unchanged — a directive firing is an observation, ranking options is advice; UK tax and legal constants are app-owned reference data (`tax_constants`, sibling of `tax_periods`), dated and status-tagged (`enacted` vs `announced`), injected into the advice and briefing payload and never recalled by the model; deadline directives fire from pending constants carrying their certainty; tax-constant updates are human-curated on the fiscal cadence (legislation is never auto-parsed into the canonical table); market direction and timing are out of scope.

**To spike before committing.** Base64 file payload round-trip across postMessage and stdio with a real multi-megabyte PDF — the one place the widget-upload design is unverified.

**Open — the `/idea` queue.** Each of these is a genuine decision the flows expose, to be committed one at a time:
- Contingent equity valuation method (intrinsic value, expected value with a vesting discount, or exclude from the headline figure).
- Vesting tax estimate model, which is scheme-type dependent (RSU vs EMI vs unapproved vs SAYE).
- Document classifier confidence threshold and the ask-the-user UX.
- Where the JSON flex layer lands (equity only, equity plus income events, or all event/snapshot tables).
- The disambiguation UX for edits: how the chat confirmation resolves "which March pension figure" reliably enough to write against, and how correct-past vs record-new is distinguished without a guess.
- The trust gate metric and threshold that flips insight into advice.
- The precise advice boundary against regulated financial advice.
- Projection engine assumptions (growth rates, contribution continuation).
- The metric definitions themselves — the exact formula each metric (`invested_assets`, `liquid_savings`, `emergency_fund_months`, `isa_allowance_remaining`, `outstanding_debt`, `projected_pension_pot`, `contribution_rate`) computes from the stores.
- The concrete `tax_constants` table and migration, the curation process that maintains it on the fiscal cadence, and the exact set of constants it holds (safe-withdrawal-rate default, pension access age, annual ISA and pension allowances, rates and bands). The pattern is decided; the table and its upkeep are not yet built.
- The briefing output shape (the observation-set contract) and whether briefings are persisted.
- The goal catalog is extensible — each new goal type is authored, not inferred; the initial set lives in `docs/goal-catalog.md`.

---

## From flows to stages

The staging plan is re-derived after this map is agreed, on one principle: **each stage delivers one flow, or a thin vertical slice of one flow, end to end** — in dependency order. POC stages validate architecture; product stages deliver flows. A stage's scope stops being a negotiation and becomes "the smallest real slice of the next flow." The open decisions above become the `/idea` queue that feeds the stages.
