import { runEthereumSync } from "./connectors/ethereum/sync.js";
import { runMonzoSync } from "./connectors/monzo/sync.js";
import { runPriceSync, type PriceSyncRow } from "./connectors/prices/sync.js";
import type { ClassOutcome, DataClass } from "./freshness.js";
import { computeFreshness } from "./freshness_read.js";

const ALL_CLASSES: DataClass[] = ["monzo", "prices", "ethereum"];

export type EnsureFreshDeps = {
  runMonzo?: () => Promise<unknown>;
  runEthereum?: () => Promise<unknown>;
  runPrices?: () => Promise<PriceSyncRow[]>;
  fetchImpl?: typeof fetch;
  now?: Date;
};

function pricesOutcome(rows: PriceSyncRow[]): ClassOutcome {
  const anyOk = rows.some((r) => r.status === "ok");
  if (rows.length > 0 && !anyOk) {
    return {
      class: "prices",
      was_stale: true,
      action: "failed",
      error: "Every automated price fetch failed.",
    };
  }
  return { class: "prices", was_stale: true, action: "refreshed" };
}

export async function ensureFresh(
  classes: DataClass[] = ALL_CLASSES,
  deps: EnsureFreshDeps = {},
): Promise<ClassOutcome[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const runMonzo = deps.runMonzo ?? (() => runMonzoSync({ backfill: false }));
  const runEthereum = deps.runEthereum ?? (() => runEthereumSync({ fetchImpl }));
  const runPrices = deps.runPrices ?? (() => runPriceSync(fetchImpl));

  const freshness = await computeFreshness(classes, deps.now);
  const outcomes: ClassOutcome[] = [];

  for (const entry of freshness) {
    const cls = entry.class;
    if (!entry.connected) {
      outcomes.push({ class: cls, was_stale: false, action: "not_connected" });
      continue;
    }
    if (!entry.is_stale) {
      outcomes.push({ class: cls, was_stale: false, action: "skipped_fresh" });
      continue;
    }
    try {
      if (cls === "monzo") {
        await runMonzo();
        outcomes.push({ class: cls, was_stale: true, action: "refreshed" });
      } else if (cls === "ethereum") {
        await runEthereum();
        outcomes.push({ class: cls, was_stale: true, action: "refreshed" });
      } else {
        outcomes.push(pricesOutcome(await runPrices()));
      }
    } catch (error) {
      outcomes.push({
        class: cls,
        was_stale: true,
        action: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return outcomes;
}
