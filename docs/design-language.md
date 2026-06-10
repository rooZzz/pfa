# PFA Design Language

The presentation layer for PFA's interactive surfaces (`ui://pfa/*`). This document captures the
chosen direction and the principles behind it so the intent survives implementation and future
change. It is the why that sits behind the token and component system in `server/src/styles/` and
`server/src/components.tsx`.

## North star

> A warm, scientific instrument for personal finance.

PFA handles real money and is auditable to the source document. The interface should feel like a
well-kept lab instrument or ledger — precise, quiet, trustworthy — not a consumer fintech app
competing for attention. Warmth keeps it human; restraint keeps it credible.

Three words, in priority order: precise, calm, warm.

## The chosen direction: Instrument

Two directions were explored over one shared token system:

- Ledger — paper-like, hairline-ruled, table-forward. The numbers, unadorned.
- Instrument — a calm dashboard: stat tiles, inline sparklines and bar meters, gently bordered
  cards, on the same tokens.

Instrument was chosen. It keeps the scientific, sepia restraint of Ledger but adds just enough
structure — tiles, meters, a sparkline — to make a financial position legible at a glance inside a
narrow side panel. The data is still the subject; the chrome only frames it. Ledger's best instincts
were folded in: hairline tables for detail, mono tabular figures, the freshness badges, and a single
quiet progress meter.

## Principles

1. The numbers are the subject. Figures are set in a monospace face with tabular lining numerals so
   columns align and digits never jitter. Typography, color, and layout exist to make those figures
   readable and trustworthy — never to upstage them.

2. Figures over prose. Let the numbers speak. A well-labelled figure, a waterfall leg, a subtotalled
   table row says more than a sentence describing it, and says it without going stale. Avoid always-on
   explanatory paragraphs that narrate what the data already shows — encode the fact as a figure, a
   label, or a structural cue instead. Reserve prose for the conditional: errors, empty states, data
   gaps, and the irreducible context a number cannot carry. Each fact appears once, in the one place it
   belongs — not restated across a legend, a key-value row, and a table.

3. Calm over flashy. This is an instrument readout, not a feed. No gradients-for-drama, no bouncing,
   no attention-grabbing. Hierarchy comes from scale, weight, and whitespace, not from saturation.

4. Warmth without decoration. The palette is a sepia system — warm near-blacks and warm papers in
   oklch — with a single clay/terracotta accent used sparingly for emphasis and interactive intent.
   One accent, applied with discipline, reads as considered; many colors read as noise.

5. Honest semantics. Money in and money out use a desaturated moss and rust that share the accent's
   chroma. No traffic-light green/red, no alarm colors. A negative balance is rendered factually, not
   anxiously. Color states a fact; it does not pass judgment. Recommendations are observations, not
   advice — the visual language follows the same rule.

6. Provenance and freshness are first-class. Every value can show where it came from and how old it
   is — a Monzo synced today, a price 38d ago, a stale badge, an audit link after a write. Trust is
   built by showing the seams, not hiding them.

7. Light and dark are equals. Both themes are authored against the same tokens, not derived as an
   afterthought. Dark is the default (it suits a focused, instrument feel and the host's typical
   appearance), but every screen is designed to be correct in light.

8. One system, composed. Screens are assembled from shared, token-backed components — tiles, meters,
   tables, badges, notes. New screens should reach for existing pieces before inventing. Consistency
   is a feature when the subject is financial truth.

9. Respect the frame. These screens render as sandboxed iframes embedded in a chat, at side-panel
   widths. Designs are vertical, compact, and wrap gracefully; they assume the host's theme and never
   pretend to be a full-page app. Fill the frame rather than assume a fixed width: the screen is fluid
   to a sane maximum and centered, so leftover space is balanced, never dumped as right-hand padding.
   Figures, tables, and tiles stretch to use the room; prose stays capped near a readable measure
   (~66ch) so a wider panel never produces over-long lines.

10. Money is never a float. Values are integer pence end-to-end and formatted at the edge. The UI
    reflects the data model's precision; it never introduces rounding of its own.

11. Motion is a whisper. A short transform-only entrance, honest loading spinners, gentle hovers —
    that is the whole vocabulary. Motion never blocks reading, and it respects `prefers-reduced-motion`.
    The entrance reveal animates transform only, never opacity, so content is never hidden if the
    animation is paused in a backgrounded iframe.

12. Consistent across screens. The same kind of thing looks the same everywhere. Every dashboard
    opens the same way — a serif title, a mono context line, then the screen's defining figure as a
    hero — so the eye learns one pattern and reuses it. Equivalent elements share a component and a
    rank; a heading, a total, or a tile should not be styled one way on net worth and another on
    cashflow. When two screens diverge, that difference must mean something.

13. One table primitive. Every labelled-amount list uses the one `DataTable`: optional column header,
    grouped rows, an optional per-row bar, and exactly one truncation control. A meter is for
    part-to-whole on a single magnitude axis; a table row is for exact, multi-column, or comparative
    figures. No hand-rolled `<table>`.

14. A disclosure ladder. Truncate (top-N plus one show-more) within a section; collapse whole
    secondary sections, with one default everywhere — the hero figure and primary chart always open,
    all detail collapsed by default; scroll only for a genuinely unbounded pick-list, never nested.
    One component owns each tier; the show-more control has a single implementation.

15. A badge taxonomy. A status badge states workflow or connection state, at most one, only in the
    masthead action slot. A quality flag marks freshness or a data gap, inline next to the datum. A
    literal datum like a tax code is a value chip, not a badge. A badge states machine or data state,
    never a category, never decoration.

16. Mono is machine-literal. Figures, tickers, dates, codes, and IDs only. Labels, eyebrows, and copy
    are Hanken. Two named serif roles (display and heading); one fewer sans weight.

17. A prose system. Three sans tiers: body (read to understand), caption (passing hints), and one
    empty-state pattern, identical on every screen. No raw tool strings rendered as prose; structure
    the connector returns.

18. One flow chrome. The masthead carries identity and at most one status badge, never navigation.
    Every step ends in one action bar: secondary or back on the left, primary on the right, a top
    divider, fixed spacing. Leaving a flow is a distinct labelled action, also bottom-left. Multi-step
    flows carry a quiet "step N of M". Every step, every flow.

19. Asset identity is one clay treatment per list. A clay-masked glyph mark where a clean glyph
    exists, a monogram otherwise — same accent, same chip, nothing privileged by colour. Always show
    the text ticker; marks live only in asset lists and the connector picker.

20. Each fact appears once. No tile that restates a chart segment that restates a table row. The one
    place a fact belongs is the one place it is shown.

21. One vocabulary for absence. "Not recorded" (never captured), "—" (not applicable), "no date"
    (value known, timing unknown) — three fixed meanings, one muted style, everywhere. Absence is
    provenance.

22. Nothing routes around the tokens. No hardcoded hex (the logo mark included), no inline style
    objects (charts especially) for anything a token or class covers. Motion obeys its own
    transform-only rule.

## Type

- Newsreader (serif) for titles and section headings — literary warmth, a scholarly note.
- Hanken Grotesk (humanist sans) for body and UI — quiet, legible, neutral.
- IBM Plex Mono for every figure and technical label — the scientific voice; tabular by default.

The serif/sans/mono split does real work: serif sets tone, sans carries copy, mono carries data.
Keep the roles distinct. These are open-licensed faces, self-hosted as woff2 — no external requests.

## Color philosophy

- Neutrals are warm — whites tinted toward paper, blacks toward espresso. Saturation on the neutrals
  stays under ~0.02 so they read as warm, not colored.
- Exactly one accent (clay) for emphasis and interactive affordance.
- Positive/negative are muted and share the accent's chroma, varying only in hue — they belong to the
  same family, so the palette stays coherent.
- Everything is defined in oklch for perceptually even steps and clean light/dark counterparts.

## Voice and copy

Plain, exact, unhurried. State the fact and, where useful, what the user can do about it. Mono for
anything literal (commands, IDs, amounts, ages). No exclamation, no hype, no emoji anywhere.

## Do / Don't

Do

- Lead with the figure; let whitespace and rules carry hierarchy.
- Use the accent for one thing per view, not five.
- Show freshness and source next to data.
- Keep new UI inside the token and component system.
- Design the dark and light states together.

Don't

- Reach for saturated or traffic-light color.
- Add chrome, gradients, or icons that don't carry meaning.
- Use emoji, or decorative illustration.
- Let a number wrap, jitter, or render as a float.
- Build a bespoke one-off when a shared component fits.

## Implementation

The design language is realized as a token-backed CSS system plus typed React primitives, bundled
into each `ui://pfa/*` resource by Vite (`vite-plugin-singlefile`), so every screen ships as one
self-contained HTML document.

- Tokens and styles: `server/src/styles/` — `fonts.css` (self-hosted woff2 `@font-face`),
  `tokens.css` (oklch colors, type scale, spacing, radii, motion; light on `:root`/`[data-theme="light"]`,
  dark on `[data-theme="dark"]`), `base.css` (reset, typography, layout utilities, the `.rise`
  entrance), `components.css` (buttons, fields, cards, stat tiles, tables, badges, meters, dropzone,
  notes, spinners), `screens.css` (screen-specific classes). `index.css` imports them in order.
- Fonts: woff2 files in `server/src/fonts/` (Newsreader 400/500, Hanken Grotesk 400/500,
  IBM Plex Mono 400/500), base64-inlined at build time. No CDN, no network at render.
- Components: `server/src/components.tsx` — `Icon`, `Btn`, `Stat`, `Badge`, `Meter`, `Sparkline`
  (measures its container via `ResizeObserver` and draws at true pixel scale, never stretched),
  `MiniBars`, `CompositionBar`, `ActionBar` (the one bottom flow-chrome bar), `EmptyState` (the one
  empty pattern), `TickerChip` (clay-tinted inline glyph or monogram). The single labelled-amount
  table is `server/src/data_table.tsx` (`DataTable`, rows or bars variant, one `DisclosureToggle`).
  All class-driven; charts are inline SVG computed from data, with dimensions and opacities in chart
  tokens (`tokens.css`) and classes (`components.css`), not inline literals.
- Marks: `server/src/logos.ts` resolves a single-fill inline SVG (`fill="currentColor"`, tinted clay
  by the container) by ticker (`glyph/`, crypto), then institution (`brand/`, e.g. Monzo), then asset
  kind (`category/`: cash/investment/pension/property). Inlined, not CSS-masked — a data-URI mask
  rendered as a solid square in the host webview.
- Goal cards (`server/src/goals_section.tsx`): a progress-to-target metric is a `Meter`; a value/total
  metric is folded into context (e.g. the yearly pension contribution is a meta item on the projection
  meter's sub-line), never its own block. An unresolved metric stays a data-gap directive.
- Formatting: `server/src/format.ts` — `formatGbp` and `formatGbpk`, the single edge where integer
  pence become display strings (U+2212 minus, en-GB grouping).
- Theme: `server/src/theme.ts` sets `data-theme` from the host `prefers-color-scheme`, defaulting to
  dark, and follows live changes.
- Screens: `server/src/{net_worth,cashflow,upload,connectors}.tsx` compose the above. Data wiring
  (`useApp`, `app.callServerTool`, result parsing, flow state) is independent of presentation.

## Authentication surfaces

The passkey sign-in, enrolment, error, and landing pages served from the public auth origin
(`server/auth/`) follow the same Instrument language. They are not `ui://pfa/*` iframes — they are
server-rendered HTML with vanilla JS (no React, no Vite), so they reuse the system differently: the
canonical `tokens.css` plus a focused `server/auth/assets/auth.css` (the auth component layer:
stage, card, brand lockup, passkey button, state blocks, device chip) are concatenated and served at
`/assets/auth.css`, with the same self-hosted woff2 served from `/assets/fonts/`. Same tokens, same
fonts, same light/dark equality (default dark, flips on `prefers-color-scheme`); only the delivery
differs from the bundled screens.

The sign-in pattern is one calm centered card — "Instrument Card". Passkey only: no password, no
email fallback. The card swaps its body across four states (idle, authenticating, success, error)
behind the real WebAuthn ceremony; a transform-only fade-rise carries the transition and respects
`prefers-reduced-motion`. Cross-device sign-in is left to the browser's native passkey UI, not a
bespoke QR surface. The brand lockup is the clay Quadrant mark + Newsreader wordmark + mono
descriptor; the destination of an OAuth authorization is shown verbatim in the card (a security cue,
not decoration). Two alternate layouts explored in the handoff (a split "security ledger" and a mono
"console readout") were set aside in favour of the card. Per the honesty rule, placeholder data from
the prototype (a greeting name, a "last sign-in" age) is omitted rather than fabricated — the card
shows only what the ceremony actually establishes.
