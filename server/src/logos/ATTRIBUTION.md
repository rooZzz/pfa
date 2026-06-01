# Cryptocurrency icons

Vendored color SVGs from [spothq/cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons), released under CC0 1.0 (public domain).

Copied locally and inlined at build time so the UI renders fully offline (no render-time network), consistent with the self-hosted fonts. Mapped to tickers in `src/logos.ts`; the set mirrors the cryptos the price connectors can resolve (`server/connectors/prices/coingecko.ts`).

All logos are assumed square and rendered in a uniform `object-fit: contain` box. To add one, drop a square SVG or PNG in this folder and add a line to `src/logos.ts`.

## Brand logos

`experian.png` is the square Experian brand mark. Company logos are trademarks of their owners; used here only to identify the account holder's own holding in a private, single-user local app (nominative use).
