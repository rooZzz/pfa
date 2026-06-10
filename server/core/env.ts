import { config } from "dotenv";
import path from "node:path";

export function loadEnv(): void {
  const serverDir = path.join(import.meta.dirname, "..");
  config({ override: true, path: path.join(serverDir, ".env") });
  const devEnv = process.env.PFA_DEV_ENV;
  if (devEnv) {
    const devPath = path.isAbsolute(devEnv) ? devEnv : path.join(serverDir, devEnv);
    config({ override: true, path: devPath });
  }
}
