import { loadEnv } from "../core/env.js";

loadEnv();

const { initDb } = await import("../core/db.js");
const { mintEnrollmentToken } = await import("../auth/enrollment.js");
const { publicOrigin } = await import("../auth/config.js");

const scopeArg = process.argv.indexOf("--scope");
const scope = scopeArg !== -1 ? (process.argv[scopeArg + 1] ?? "pfa:write") : "pfa:write";

if (scope !== "pfa:read" && scope !== "pfa:write") {
  process.stderr.write(`Unknown scope "${scope}". Valid values: pfa:read, pfa:write\n`);
  process.exit(1);
}

initDb();
const token = mintEnrollmentToken(scope);

process.stdout.write(
  "Open this single-use enrolment link on the device you want to register,\n" +
    "at the public domain so the passkey binds to the right RP ID:\n\n" +
    `  ${publicOrigin()}/enroll?token=${token}\n\n` +
    `Scope: ${scope}\n` +
    "The link expires in 30 minutes.\n",
);
