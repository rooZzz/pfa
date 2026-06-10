import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, initDb } from "../core/db.js";
import { NLQ_TABLES } from "../query/nlq_allowlist.js";

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "schema_catalog.md",
);

function catalogTables(catalog: string): string[] {
  const re = /^## Table: `pfa\.([a-z_]+)`/gm;
  const names: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(catalog)) !== null) {
    names.push(match[1]);
  }
  return names.sort();
}

function columnsOf(table: string): string[] {
  return (getDb().prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (r) => r.name,
  );
}

function sectionFor(catalog: string, table: string): string | null {
  const heading = "## Table: `pfa." + table + "`";
  const start = catalog.indexOf(heading);
  if (start === -1) return null;
  const next = catalog.indexOf("\n## ", start + heading.length);
  return catalog.slice(start, next === -1 ? undefined : next);
}

let catalog: string;

beforeAll(() => {
  initDb();
  catalog = fs.readFileSync(CATALOG_PATH, "utf-8");
});

describe("schema_catalog is the NLQ allow-list", () => {
  it("documents exactly the allow-listed tables (no secrets, no extras)", () => {
    expect(catalogTables(catalog)).toEqual([...NLQ_TABLES].sort());
  });

  it("documents every column of every allow-listed table", () => {
    const missing: string[] = [];
    for (const table of NLQ_TABLES) {
      const section = sectionFor(catalog, table);
      if (section === null) {
        missing.push(`${table} (no section)`);
        continue;
      }
      for (const col of columnsOf(table)) {
        if (!section.includes("`" + col + "`")) {
          missing.push(`${table}.${col}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
