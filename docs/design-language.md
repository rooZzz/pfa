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

2. Calm over flashy. This is an instrument readout, not a feed. No gradients-for-drama, no bouncing,
   no attention-grabbing. Hierarchy comes from scale, weight, and whitespace, not from saturation.

3. Warmth without decoration. The palette is a sepia system — warm near-blacks and warm papers in
   oklch — with a single clay/terracotta accent used sparingly for emphasis and interactive intent.
   One accent, applied with discipline, reads as considered; many colors read as noise.

4. Honest semantics. Money in and money out use a desaturated moss and rust that share the accent's
   chroma. No traffic-light green/red, no alarm colors. A negative balance is rendered factually, not
   anxiously. Color states a fact; it does not pass judgment. Recommendations are observations, not
   advice — the visual language follows the same rule.

5. Provenance and freshness are first-class. Every value can show where it came from and how old it
   is — a Monzo synced today, a price 38d ago, a stale badge, an audit link after a write. Trust is
   built by showing the seams, not hiding them.

6. Light and dark are equals. Both themes are authored against the same tokens, not derived as an
   afterthought. Dark is the default (it suits a focused, instrument feel and the host's typical
   appearance), but every screen is designed to be correct in light.

7. One system, composed. Screens are assembled from shared, token-backed components — tiles, meters,
   tables, badges, notes. New screens should reach for existing pieces before inventing. Consistency
   is a feature when the subject is financial truth.

8. Respect the frame. These screens render as sandboxed iframes embedded in a chat, at side-panel
   widths. Designs are vertical, compact, and wrap gracefully; they assume the host's theme and never
   pretend to be a full-page app.

9. Money is never a float. Values are integer pence end-to-end and formatted at the edge. The UI
   reflects the data model's precision; it never introduces rounding of its own.

10. Motion is a whisper. A short transform-only entrance, honest loading spinners, gentle hovers —
    that is the whole vocabulary. Motion never blocks reading, and it respects `prefers-reduced-motion`.
    The entrance reveal animates transform only, never opacity, so content is never hidden if the
    animation is paused in a backgrounded iframe.

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
- Fonts: woff2 files in `server/src/fonts/` (Newsreader 400/500, Hanken Grotesk 400/500/600,
  IBM Plex Mono 400/500), base64-inlined at build time. No CDN, no network at render.
- Components: `server/src/components.tsx` — `Icon`, `Btn`, `Stat`, `Badge`, `Meter`, `Sparkline`,
  `MiniBars`, `CompositionBar`. All class-driven; charts are inline SVG computed from data.
- Formatting: `server/src/format.ts` — `formatGbp` and `formatGbpk`, the single edge where integer
  pence become display strings (U+2212 minus, en-GB grouping).
- Theme: `server/src/theme.ts` sets `data-theme` from the host `prefers-color-scheme`, defaulting to
  dark, and follows live changes.
- Screens: `server/src/{net_worth,cashflow,upload,connectors}.tsx` compose the above. Data wiring
  (`useApp`, `app.callServerTool`, result parsing, flow state) is independent of presentation.
