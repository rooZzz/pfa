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
