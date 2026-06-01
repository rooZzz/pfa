import btc from "./logos/btc.svg";
import eth from "./logos/eth.svg";
import link from "./logos/link.svg";
import sol from "./logos/sol.svg";
import ada from "./logos/ada.svg";
import xrp from "./logos/xrp.svg";
import doge from "./logos/doge.svg";
import ltc from "./logos/ltc.svg";
import dot from "./logos/dot.svg";
import matic from "./logos/matic.svg";
import avax from "./logos/avax.svg";
import usdt from "./logos/usdt.svg";
import usdc from "./logos/usdc.svg";
import experian from "./logos/experian.png";

const LOGOS: Record<string, string> = {
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
  EXPN: experian,
};

export function tickerToLogo(ticker: string | null | undefined): string | null {
  if (!ticker) return null;
  const key = ticker
    .trim()
    .toUpperCase()
    .replace(/\.(L|LON|UK)$/, "");
  return LOGOS[key] ?? null;
}
