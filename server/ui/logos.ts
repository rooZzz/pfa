import btc from "./logos/glyph/btc.svg?raw";
import eth from "./logos/glyph/eth.svg?raw";
import link from "./logos/glyph/link.svg?raw";
import sol from "./logos/glyph/sol.svg?raw";
import ada from "./logos/glyph/ada.svg?raw";
import xrp from "./logos/glyph/xrp.svg?raw";
import doge from "./logos/glyph/doge.svg?raw";
import ltc from "./logos/glyph/ltc.svg?raw";
import dot from "./logos/glyph/dot.svg?raw";
import matic from "./logos/glyph/matic.svg?raw";
import avax from "./logos/glyph/avax.svg?raw";
import usdt from "./logos/glyph/usdt.svg?raw";
import usdc from "./logos/glyph/usdc.svg?raw";
import cash from "./logos/category/cash.svg?raw";
import investment from "./logos/category/investment.svg?raw";
import pension from "./logos/category/pension.svg?raw";
import property from "./logos/category/property.svg?raw";
import monzo from "./logos/brand/monzo.svg?raw";

const GLYPHS: Record<string, string> = {
  BTC: btc,
  ETH: eth,
  LINK: link,
  SOL: sol,
  ADA: ada,
  XRP: xrp,
  DOGE: doge,
  LTC: ltc,
  DOT: dot,
  MATIC: matic,
  AVAX: avax,
  USDT: usdt,
  USDC: usdc,
};

export function tickerToGlyph(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  const key = ticker
    .trim()
    .toUpperCase()
    .replace(/\.(L|LON|UK)$/, "");
  return GLYPHS[key] ?? null;
}

const INSTITUTIONS: Record<string, string> = {
  monzo,
};

export function institutionToGlyph(
  institution: string | null | undefined,
): string | null {
  if (!institution) return null;
  return INSTITUTIONS[institution.trim().toLowerCase()] ?? null;
}

const CATEGORY_GLYPHS: Record<string, string> = {
  account: cash,
  asset: investment,
  pension,
  property,
  mortgage: property,
};

export function categoryGlyph(kind: string): string | null {
  return CATEGORY_GLYPHS[kind] ?? null;
}
