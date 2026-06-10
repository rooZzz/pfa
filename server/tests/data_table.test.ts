import { describe, expect, it } from "vitest";
import { partitionGroupRows, topN } from "../ui/data_table.js";
import type { DataRow } from "../ui/data_table.js";

function row(key: string, valuePence: number | null): DataRow {
  return { key, label: key, valuePence };
}

describe("partitionGroupRows", () => {
  it("returns all rows when no truncate limit is set", () => {
    const rows = [row("a", 300), row("b", 100), row("c", 200)];
    const result = partitionGroupRows(rows, {});
    expect(result.visible).toHaveLength(3);
    expect(result.hidden).toHaveLength(0);
    expect(result.hiddenSumPence).toBe(0);
    expect(result.subtotalPence).toBe(600);
  });

  it("returns all rows when count is at or below the limit", () => {
    const rows = [row("a", 300), row("b", 100)];
    const result = partitionGroupRows(rows, { truncate: 2 });
    expect(result.visible).toHaveLength(2);
    expect(result.hidden).toHaveLength(0);
  });

  it("shows the top-N largest and hides the rest when sorting by value", () => {
    const rows = [row("a", 100), row("b", 500), row("c", 300), row("d", 200)];
    const result = partitionGroupRows(rows, { truncate: 2, sortByValue: true });
    expect(result.visible.map((r) => r.key)).toEqual(["b", "c"]);
    expect(result.hidden.map((r) => r.key)).toEqual(["d", "a"]);
    expect(result.hiddenSumPence).toBe(300);
    expect(result.subtotalPence).toBe(1100);
  });

  it("preserves input order when not sorting by value", () => {
    const rows = [row("a", 100), row("b", 500), row("c", 300)];
    const result = partitionGroupRows(rows, { truncate: 2 });
    expect(result.visible.map((r) => r.key)).toEqual(["a", "b"]);
    expect(result.hidden.map((r) => r.key)).toEqual(["c"]);
    expect(result.hiddenSumPence).toBe(300);
  });

  it("reveals every row and clears hidden when expanded, keeping full subtotal", () => {
    const rows = [row("a", 100), row("b", 500), row("c", 300), row("d", 200)];
    const result = partitionGroupRows(rows, {
      truncate: 2,
      sortByValue: true,
      expanded: true,
    });
    expect(result.visible).toHaveLength(4);
    expect(result.hidden).toHaveLength(0);
    expect(result.hiddenSumPence).toBe(0);
    expect(result.subtotalPence).toBe(1100);
  });

  it("treats null values as zero in sums and sorts them last", () => {
    const rows = [row("a", null), row("b", 400), row("c", 100)];
    const result = partitionGroupRows(rows, { truncate: 1, sortByValue: true });
    expect(result.visible.map((r) => r.key)).toEqual(["b"]);
    expect(result.hidden.map((r) => r.key)).toEqual(["c", "a"]);
    expect(result.hiddenSumPence).toBe(100);
    expect(result.subtotalPence).toBe(500);
  });

  it("does not mutate the input array when sorting", () => {
    const rows = [row("a", 100), row("b", 500)];
    partitionGroupRows(rows, { truncate: 1, sortByValue: true });
    expect(rows.map((r) => r.key)).toEqual(["a", "b"]);
  });
});

describe("topN", () => {
  const get = (n: { v: number }) => n.v;

  it("returns all items when under or at the limit, or no limit set", () => {
    const items = [{ v: 30 }, { v: 10 }];
    expect(topN(items, get, {}).visible).toHaveLength(2);
    expect(topN(items, get, { limit: 2 }).hidden).toHaveLength(0);
    expect(topN(items, get, { limit: 5 }).hidden).toHaveLength(0);
  });

  it("keeps input order, slices the tail, and sums hidden values", () => {
    const items = [{ v: 500 }, { v: 300 }, { v: 200 }, { v: 100 }];
    const result = topN(items, get, { limit: 2 });
    expect(result.visible.map(get)).toEqual([500, 300]);
    expect(result.hidden.map(get)).toEqual([200, 100]);
    expect(result.hiddenSumPence).toBe(300);
  });

  it("reveals everything and clears the hidden sum when expanded", () => {
    const items = [{ v: 500 }, { v: 300 }, { v: 200 }];
    const result = topN(items, get, { limit: 1, expanded: true });
    expect(result.visible).toHaveLength(3);
    expect(result.hiddenSumPence).toBe(0);
  });
});
