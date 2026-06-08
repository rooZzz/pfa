import { readConnectorState } from "./connectors/state.js";
import { getKysely } from "./db.js";
import {
  FRESHNESS_TTL_SECONDS,
  type ClassFreshness,
  type DataClass,
} from "./freshness.js";

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
