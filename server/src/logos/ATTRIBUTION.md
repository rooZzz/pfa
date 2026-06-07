# Logo and glyph marks

All marks are vendored locally and inlined at build time so the UI renders fully offline (no render-time network), consistent with the self-hosted fonts. They are rendered as a single fill tinted to the clay accent via `TickerChip` / the net-worth line marks, so every source is `fill="currentColor"` with the background disc removed. Mapped to tickers, institutions, and categories in `src/logos.ts`.

## Crypto glyphs (`glyph/`)

Monochrome single-fill glyphs derived from [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) (CC0 1.0, public domain): background disc stripped, glyph recolored to `currentColor` (ETH keeps its facet opacities). The set mirrors the cryptos the price connectors can resolve (`server/connectors/prices/coingecko.ts`). To add one, drop a single-fill SVG here and add a line to `src/logos.ts`.

## Category marks (`category/`)

`cash`, `investment`, `pension`, `property` — original geometric glyphs authored for this project (no third-party source), single-fill `currentColor`, used as per-line category marks in the net-worth table.

## Brand marks (`brand/`)

`monzo.svg` is the Monzo mark from [simple-icons](https://github.com/simple-icons/simple-icons) (icon paths released under CC0 1.0), recolored to `currentColor`. Company logos are trademarks of their owners; used here only to identify the account holder's own holdings in a private, single-user local app (nominative use).
