import { config } from "dotenv";
import path from "node:path";

config({ override: true, path: path.join(import.meta.dirname, ".env") });

const { mintAccessToken } = await import("./auth/tokens.js");

const { token } = await mintAccessToken("break-glass", undefined, undefined);
process.stdout.write(`${token}\n`);
