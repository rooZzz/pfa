import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupAuthEnv } from "./auth_env.js";
import { getDb, initDb } from "../core/db.js";
import {
  registrationOptions,
  authenticationOptions,
  verifyAuthentication,
  hasCredential,
} from "../auth/webauthn.js";
import { nowSec } from "../auth/util.js";

beforeAll(async () => {
  await setupAuthEnv();
});

beforeEach(() => {
  initDb();
  getDb().exec("DELETE FROM webauthn_credential; DELETE FROM webauthn_challenge;");
});

describe("webauthn options", () => {
  it("reports no credential until one is stored", () => {
    expect(hasCredential()).toBe(false);
    getDb()
      .prepare(
        "INSERT INTO webauthn_credential (credential_id, public_key, counter, created_at) VALUES ('id', 'pk', 0, ?)",
      )
      .run(nowSec());
    expect(hasCredential()).toBe(true);
  });

  it("generates registration options bound to the RP and stores a challenge", async () => {
    const { options, challengeId } = await registrationOptions();
    expect(options.challenge).toBeTruthy();
    expect(options.rp.id).toBe("pfa.test");
    const row = getDb()
      .prepare("SELECT kind FROM webauthn_challenge WHERE id = ?")
      .get(challengeId) as { kind: string } | undefined;
    expect(row?.kind).toBe("register");
  });

  it("generates authentication options bound to the request id", async () => {
    const { options, challengeId } = await authenticationOptions("req-123");
    expect(options.challenge).toBeTruthy();
    const row = getDb()
      .prepare("SELECT kind, req FROM webauthn_challenge WHERE id = ?")
      .get(challengeId) as { kind: string; req: string } | undefined;
    expect(row?.kind).toBe("authenticate");
    expect(row?.req).toBe("req-123");
  });

  it("rejects an assertion whose challenge is bound to a different request", async () => {
    const { challengeId } = await authenticationOptions("reqA");
    await expect(
      verifyAuthentication(
        challengeId,
        { id: "x" } as unknown as Parameters<typeof verifyAuthentication>[1],
        "reqB",
      ),
    ).rejects.toThrow();
  });
});
