import { config } from "dotenv";
import path from "node:path";

export function loadEnv(): void {
  const dir = import.meta.dirname;
  config({ override: true, path: path.join(dir, ".env") });
  const devEnv = process.env.PFA_DEV_ENV;
  if (devEnv) {
    const devPath = path.isAbsolute(devEnv) ? devEnv : path.join(dir, devEnv);
    config({ override: true, path: devPath });
  }
}
