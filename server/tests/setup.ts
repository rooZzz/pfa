import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

const envPath = path.join(import.meta.dirname, "../.env");
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const testDir = path.join(os.tmpdir(), "pfa-test");
process.env.PFA_DIR = testDir;

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
