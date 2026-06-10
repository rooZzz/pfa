import { loadEnv } from "../core/env.js";

loadEnv();

const { initDb } = await import("../core/db.js");
const { mintEnrollmentToken } = await import("../auth/enrollment.js");
const { publicOrigin } = await import("../auth/config.js");

initDb();
const token = mintEnrollmentToken();

process.stdout.write(
  "Open this single-use enrolment link on the device you want to register,\n" +
    "at the public domain so the passkey binds to the right RP ID:\n\n" +
    `  ${publicOrigin()}/enroll?token=${token}\n\n` +
    "The link expires in 30 minutes.\n",
);
