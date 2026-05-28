import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { getDb, initDb } from "../db.js";

const CATALOG_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "docs",
  "schema_catalog.md",
);

function userTables(): string[] {
  return (
    getDb()
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_migrations'
         ORDER BY name`,
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
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
let tables: string[];

beforeAll(() => {
  initDb();
  catalog = fs.readFileSync(CATALOG_PATH, "utf-8");
  tables = userTables();
});

describe("schema_catalog coverage", () => {
  it("documents every table in the live schema", () => {
    const undocumented = tables.filter((t) => sectionFor(catalog, t) === null);
    expect(undocumented).toEqual([]);
  });

  it("documents every column of every table", () => {
    const missing: string[] = [];
    for (const table of tables) {
      const section = sectionFor(catalog, table);
      if (section === null) continue;
      for (const col of columnsOf(table)) {
        if (!section.includes("`" + col + "`")) {
          missing.push(`${table}.${col}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
