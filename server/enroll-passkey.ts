import { config } from "dotenv";
import path from "node:path";

config({ override: true, path: path.join(import.meta.dirname, ".env") });

const { initDb } = await import("./db.js");
const { mintEnrollmentToken } = await import("./auth/enrollment.js");
const { publicOrigin } = await import("./auth/config.js");

initDb();
const token = mintEnrollmentToken();

process.stdout.write(
  "Open this single-use enrolment link on the device you want to register,\n" +
    "at the public domain so the passkey binds to the right RP ID:\n\n" +
    `  ${publicOrigin()}/enroll?token=${token}\n\n` +
    "The link expires in 30 minutes.\n",
);
