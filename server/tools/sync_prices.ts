import { runPriceSync } from "../connectors/prices/sync.js";

export async function syncPrices(): Promise<string> {
  const results = await runPriceSync(fetch);
  if (results.length === 0) {
    return "No assets have an automated price source. Capture stock/ETF/crypto with a ticker to enable price sync.";
  }

  const ok = results.filter((r) => r.status === "ok");
  const failed = results.filter((r) => r.status === "error");

  const lines = [`Synced prices: ${ok.length} of ${results.length} asset(s) updated.`];
  for (const r of ok) {
    lines.push(
      `- ${r.ticker}: £${(r.price_pence! / 100).toFixed(2)} (${r.instrument_name}) as of ${r.as_of} UTC`,
    );
  }
  for (const r of failed) {
    lines.push(`- ${r.ticker ?? r.name}: not updated — ${r.message}`);
  }
  if (ok.length > 0) {
    lines.push(
      "Confirm each source instrument matches the security you hold; a wrong ticker fetches a different company's price.",
    );
  }
  return lines.join("\n");
}
