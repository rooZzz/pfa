# Cryptocurrency icons

Vendored color SVGs from [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons), released under CC0 1.0 (public domain).

Copied locally and inlined at build time so the UI renders fully offline (no render-time network), consistent with the self-hosted fonts. Mapped to tickers in `src/logos.ts`; the set mirrors the cryptos the price connectors can resolve (`server/connectors/prices/coingecko.ts`).

All logos are assumed square and rendered in a uniform `object-fit: contain` box. To add one, drop a square SVG or PNG in this folder and add a line to `src/logos.ts`.

## Glyph marks (`glyph/`)

Monochrome single-fill versions of the crypto marks (background disc removed, `fill="currentColor"`), inlined and clay-tinted via `TickerChip`. Derived from the color sources above; same CC0 terms.

## Category marks (`category/`)

`cash`, `investment`, `pension`, `property` — original geometric glyphs authored for this project (no third-party source), single-fill `currentColor`, used as per-line category marks in the net-worth table.

## Brand logos

`experian.png` is the square Experian brand mark. `brand/monzo.svg` is the Monzo mark from [simple-icons](https://github.com/simple-icons/simple-icons) (icon paths released under CC0 1.0), recolored to `currentColor`. Company logos are trademarks of their owners; used here only to identify the account holder's own holdings in a private, single-user local app (nominative use).
