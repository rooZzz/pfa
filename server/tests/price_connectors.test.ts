import { describe, expect, it } from "vitest";
import { fetchCoinGeckoQuote, coinId } from "../connectors/prices/coingecko.js";
import { fetchYahooQuote, toGbpPence, yahooSymbol } from "../connectors/prices/yahoo.js";

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function yahooFetch(byUrl: Record<string, unknown>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [key, body] of Object.entries(byUrl)) {
      if (url.includes(key)) return jsonResponse(body);
    }
    throw new Error(`unexpected url ${url}`);
  }) as typeof fetch;
}

function chart(meta: Record<string, unknown>) {
  return { chart: { result: [{ meta }], error: null } };
}

describe("yahooSymbol", () => {
  it("appends .L for shares and -GBP for crypto", () => {
    expect(yahooSymbol("expn", "stock")).toBe("EXPN.L");
    expect(yahooSymbol("BTC", "crypto")).toBe("BTC-GBP");
  });
});

describe("toGbpPence", () => {
  it("treats GBp (pence) quotes one-to-one", async () => {
    expect(await toGbpPence(2675, "GBp", yahooFetch({}))).toBe(2675);
  });
  it("multiplies GBP (pounds) quotes by 100", async () => {
    expect(await toGbpPence(26.75, "GBP", yahooFetch({}))).toBe(2675);
  });
  it("converts a foreign currency via the GBP exchange rate", async () => {
    const fetchImpl = yahooFetch({
      USDGBP: chart({ regularMarketPrice: 0.8 }),
    });
    expect(await toGbpPence(150, "USD", fetchImpl)).toBe(12000);
  });
});

describe("fetchYahooQuote", () => {
  it("returns GBP pence and the source instrument name for an LSE share", async () => {
    const fetchImpl = yahooFetch({
      "EXPN.L": chart({
        regularMarketPrice: 2675,
        currency: "GBp",
        regularMarketTime: 1700000000,
        longName: "Experian plc",
        exchangeName: "LSE",
        symbol: "EXPN.L",
      }),
    });
    const quote = await fetchYahooQuote("EXPN", "stock", fetchImpl);
    expect(quote.unit_price_pence).toBe(2675);
    expect(quote.currency).toBe("GBP");
    expect(quote.instrument_name).toBe("Experian plc");
    expect(quote.source_symbol).toBe("EXPN.L");
  });

  it("throws when Yahoo returns no price", async () => {
    const fetchImpl = yahooFetch({ "EXPN.L": chart({}) });
    await expect(fetchYahooQuote("EXPN", "stock", fetchImpl)).rejects.toThrow(
      /no price/i,
    );
  });
});

describe("coinId", () => {
  it("maps known tickers and rejects unknown ones", () => {
    expect(coinId("btc")).toBe("bitcoin");
    expect(() => coinId("WAT")).toThrow(/No CoinGecko mapping/);
  });
});

describe("fetchCoinGeckoQuote", () => {
  it("converts the GBP price to pence", async () => {
    const fetchImpl = (async () =>
      jsonResponse({
        bitcoin: { gbp: 50000.5, last_updated_at: 1700000000 },
      })) as typeof fetch;
    const quote = await fetchCoinGeckoQuote("BTC", fetchImpl);
    expect(quote.unit_price_pence).toBe(5000050);
    expect(quote.instrument_name).toBe("bitcoin");
  });
});
