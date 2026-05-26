import { config } from "dotenv";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

config({ override: true, path: path.join(import.meta.dirname, "../.env") });

const testDir = path.join(os.tmpdir(), "pfa-test");
process.env.PFA_DIR = testDir;

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
