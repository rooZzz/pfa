import { loadEnv } from "../env.js";

loadEnv();

const { mintAccessToken } = await import("../auth/tokens.js");

const { token } = await mintAccessToken("break-glass", undefined);
process.stdout.write(`${token}\n`);
