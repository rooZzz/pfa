const MINUS = "−";
const POUND = "£";

export function formatGbp(pence: number, opts: { whole?: boolean } = {}): string {
  const abs = Math.abs(pence);
  const sign = pence < 0 ? MINUS : "";
  const fractionDigits = opts.whole ? 0 : 2;
  return (
    sign +
    POUND +
    (abs / 100).toLocaleString("en-GB", {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    })
  );
}

export function formatGbpk(pence: number): string {
  const value = pence / 100;
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : "";
  if (abs >= 1_000_000) return sign + POUND + (abs / 1_000_000).toFixed(2) + "m";
  if (abs >= 1000)
    return sign + POUND + (abs / 1000).toFixed(abs >= 100_000 ? 0 : 1) + "k";
  return sign + POUND + abs.toFixed(0);
}
