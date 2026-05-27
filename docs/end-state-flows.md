# End-State Flow Map

**Status:** Draft for refinement. Defines the finished-app target the staged plan derives from. Not a description of what exists today.

**Purpose:** We have been planning stages forward from the current code, so every new concern reopens the stage definitions. This document fixes the destination. Stages are then derived backward from it. Capabilities are not invented per stage — they fall out of the flows below.

---

## The seven flows

Three operational flows move and maintain data. Four capability flows turn that data into value. The fourth capability flow — advice — is new, dangerous, and gated.

| # | Flow | Kind | One line |
|---|---|---|---|
| 1 | Ingest | Operational | Any document, value, or connector becomes auditable, structured data |
| 2 | Edit | Operational | Any committed source can be corrected or removed without losing history |
| 3 | Query | Operational | Any question becomes a grounded answer with provenance |
| 4 | Net worth | Capability | What I own, realised vs contingent, point-in-time and trended |
| 5 | Cashflow | Capability | What comes in and goes out, tax-aware, historic and projected |
| 6 | Insight | Capability | Facts surfaced from my own data, no judgement attached |
| 7 | Advice | Capability | Sound planning guidance grounded in my data and UK rules |

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

**What the model does.** Captures the raw input, writes a system-generated JSON file as the source document, and writes the event/snapshot row directly.

**Read / written.** A `documents` row (source_type `manual`, the JSON file) plus the data row with `source_id`.

**What the user sees.** Chat acknowledgement.

**Failure / review.** No review step — the user is the source. The JSON file preserves the raw input as entered, as the audit trail.

### Connectors (high trust)

**Trigger.** The user wants an external source to feed in automatically. Two phases: setup is a deliberate user action; sync is autonomous thereafter.

**Surface — setup uses specialised UI, not file drop.** `ui://connectors` captures connector-specific configuration through purpose-built components: an API key field for Monzo, a wallet address field for Ethereum, plus enable/disable and schedule. This is a different interaction from the upload drop zone and must not be modelled as one.

**What the model does.** After setup, a background OS process (launchd) runs independently of Claude Desktop, calling the connector API on schedule and writing structured rows directly.

**Read / written.** Connector rows `INSERT OR IGNORE` on `external_id` (idempotent). Each run writes a connector run record to `documents`.

**What the user sees.** Setup confirmation in `ui://connectors`; thereafter data simply appears. The user does not touch the connector again unless reconfiguring.

**Failure / review.** No review step — structured, high trust, deduplicated. Setup validation (bad API key, malformed wallet address) fails loudly at the `ui://connectors` boundary.

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

**What the model does.** Grounds guidance in the user's actual data plus UK tax and financial domain logic, and produces sound, conservative planning advice: pension annual-allowance headroom, ISA optimisation, overpay-versus-invest, tax-efficient timing of equity disposals against CGT.

**Read / written.** Reads across all stores plus the projection engine. No writes, and critically no autonomous action — advice is surfaced; the user decides and acts.

**What the user sees.** The recommendation, the data it rests on, the assumptions made, and the calculation. Advice is auditable in the same way a stored number is.

**Guardrails — this is the dangerous flow.**
- Trust gate. Advice is locked until the insight layer has demonstrated sustained accuracy. The gating metric and threshold are an open decision.
- Show the working, always. No black-box recommendation.
- Surface staleness and confidence. Advice built on a six-month-old balance says so.
- Conservative and reversible bias. Prefer guidance that is hard to regret.
- Hard boundary. Planning guidance grounded in the user's own numbers and UK rules — not regulated financial advice, not market timing, not product selection. Framed explicitly as such.

This does not contradict the "observations only" decision in the log — it is the state that decision was reserving the door for, once trust is established.

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

---

## Decided vs open

**Decided (locked in `docs/architecture.md` and the decision log, plus this round).** Local stdio MCP server as the app; Claude Desktop as harness; SQLite write store + DuckDB read; event/snapshot table patterns; `documents` as universal source anchor; integer amounts, explicit currency, UTC; `tax_periods` for UK tax year; mandatory human review for uploads; connector dedup via `external_id`; connector setup through specialised `ui://connectors` components; uploads are one-source, one-document at a time (no multi-file, no multi-type, bulk backfill deferred); uploads enter through the `ui://upload` widget only, sent to the server as base64 via `app.callServerTool` (no file path, no chat attachment, never model-visible); `ingest_document` is content-based, not path-based; edits fold into the manual-entry path (no `ui://sources` surface) — the LLM extracts correction intent, a deterministic primitive performs close-and-reinsert (snapshots), superseding entries (events), or a tombstone (removal); never an in-place UPDATE or DELETE, never LLM-generated mutation SQL; the read pipeline stays read-only.

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

---

## From flows to stages

The staging plan is re-derived after this map is agreed, on one principle: **each stage delivers one flow, or a thin vertical slice of one flow, end to end** — in dependency order. POC stages validate architecture; product stages deliver flows. A stage's scope stops being a negotiation and becomes "the smallest real slice of the next flow." The open decisions above become the `/idea` queue that feeds the stages.
