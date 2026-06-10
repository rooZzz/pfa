import { runEthereumSync } from "./connectors/ethereum/sync.js";
import { runMonzoSync } from "./connectors/monzo/sync.js";
import { runPriceSync, type PriceSyncRow } from "./connectors/prices/sync.js";
import { readConnectorState } from "./connectors/state.js";
import { getKysely } from "./db.js";

export type DataClass = "monzo" | "prices" | "ethereum";

export const FRESHNESS_TTL_SECONDS: Record<DataClass, number> = {
  monzo: 86_400,
  prices: 3_600,
  ethereum: 86_400,
};

export type ClassFreshness = {
  class: DataClass;
  connected: boolean;
  last_at: string | null;
  age_seconds: number | null;
  ttl_seconds: number;
  is_stale: boolean;
};

export type ClassAction = "refreshed" | "failed" | "skipped_fresh" | "not_connected";

export type ClassOutcome = {
  class: DataClass;
  was_stale: boolean;
  action: ClassAction;
  error?: string;
};

const ALL_CLASSES: DataClass[] = ["monzo", "prices", "ethereum"];

type Source = { connected: boolean; last_at: string | null };

async function connectorSource(provider: string): Promise<Source> {
  const state = await readConnectorState(provider);
  if (!state) return { connected: false, last_at: null };
  return { connected: true, last_at: state.last_synced_at };
}

async function priceSource(): Promise<Source> {
  const kysely = getKysely();
  const counted = await kysely
    .selectFrom("assets")
    .where("price_source", "!=", "manual")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .executeTakeFirst();
  if (Number(counted?.n ?? 0) === 0) return { connected: false, last_at: null };

  const latest = await kysely
    .selectFrom("asset_prices")
    .innerJoin("assets", "assets.id", "asset_prices.asset_id")
    .where("assets.price_source", "!=", "manual")
    .where("asset_prices.superseded_by", "is", null)
    .select((eb) => eb.fn.max<string | null>("asset_prices.as_of").as("last_at"))
    .executeTakeFirst();
  return { connected: true, last_at: latest?.last_at ?? null };
}

async function sourceForClass(cls: DataClass): Promise<Source> {
  if (cls === "monzo") return connectorSource("monzo");
  if (cls === "ethereum") return connectorSource("ethereum");
  return priceSource();
}

export async function computeFreshness(
  classes: DataClass[] = ALL_CLASSES,
  now: Date = new Date(),
): Promise<ClassFreshness[]> {
  const result: ClassFreshness[] = [];
  for (const cls of classes) {
    const ttl_seconds = FRESHNESS_TTL_SECONDS[cls];
    const { connected, last_at } = await sourceForClass(cls);
    const age_seconds =
      last_at != null
        ? Math.floor((now.getTime() - new Date(last_at).getTime()) / 1000)
        : null;
    const is_stale = connected && (age_seconds == null || age_seconds > ttl_seconds);
    result.push({ class: cls, connected, last_at, age_seconds, ttl_seconds, is_stale });
  }
  return result;
}

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
