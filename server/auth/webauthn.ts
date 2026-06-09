import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { getDb } from "../db.js";
import { rpId, rpName, publicOrigin, authorizedSubject } from "./config.js";
import { nowSec, randomId } from "./util.js";

const CHALLENGE_TTL = 300;

type CredentialRow = {
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string | null;
};

function storeChallenge(
  kind: "register" | "authenticate",
  challenge: string,
  req: string | null,
): string {
  const id = randomId();
  getDb()
    .prepare(
      "INSERT INTO webauthn_challenge (id, kind, challenge, req, expires_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, kind, challenge, req, nowSec() + CHALLENGE_TTL);
  return id;
}

function takeChallenge(
  id: string,
  kind: "register" | "authenticate",
): { challenge: string; req: string | null } {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT kind, challenge, req, expires_at FROM webauthn_challenge WHERE id = ?",
    )
    .get(id) as
    | { kind: string; challenge: string; req: string | null; expires_at: number }
    | undefined;
  db.prepare("DELETE FROM webauthn_challenge WHERE id = ?").run(id);
  if (!row || row.kind !== kind || row.expires_at < nowSec()) {
    throw new Error("challenge not found or expired");
  }
  return { challenge: row.challenge, req: row.req ?? null };
}

function listCredentials(): CredentialRow[] {
  return getDb()
    .prepare(
      "SELECT credential_id, public_key, counter, transports FROM webauthn_credential",
    )
    .all() as CredentialRow[];
}

export function hasCredential(): boolean {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM webauthn_credential").get() as {
    n: number;
  };
  return row.n > 0;
}

export async function registrationOptions(): Promise<{
  options: Awaited<ReturnType<typeof generateRegistrationOptions>>;
  challengeId: string;
}> {
  const options = await generateRegistrationOptions({
    rpName: rpName(),
    rpID: rpId(),
    userName: authorizedSubject(),
    userID: new TextEncoder().encode(authorizedSubject()),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: listCredentials().map((c) => ({ id: c.credential_id })),
  });
  return { options, challengeId: storeChallenge("register", options.challenge, null) };
}

export async function verifyRegistration(
  challengeId: string,
  response: RegistrationResponseJSON,
  label: string | undefined,
): Promise<void> {
  const { challenge: expectedChallenge } = takeChallenge(challengeId, "register");
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: publicOrigin(),
    expectedRPID: rpId(),
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("passkey registration could not be verified");
  }
  const cred = verification.registrationInfo.credential;
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO webauthn_credential
       (credential_id, public_key, counter, transports, label, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    )
    .run(
      cred.id,
      Buffer.from(cred.publicKey).toString("base64url"),
      cred.counter,
      cred.transports ? JSON.stringify(cred.transports) : null,
      label ?? null,
      nowSec(),
    );
}

export async function authenticationOptions(req: string): Promise<{
  options: Awaited<ReturnType<typeof generateAuthenticationOptions>>;
  challengeId: string;
}> {
  const options = await generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "required",
  });
  return {
    options,
    challengeId: storeChallenge("authenticate", options.challenge, req),
  };
}

export async function verifyAuthentication(
  challengeId: string,
  response: AuthenticationResponseJSON,
  expectedReq: string,
): Promise<void> {
  const { challenge: expectedChallenge, req } = takeChallenge(
    challengeId,
    "authenticate",
  );
  if (req !== expectedReq) {
    throw new Error("challenge is not bound to this authorization request");
  }
  const row = getDb()
    .prepare("SELECT * FROM webauthn_credential WHERE credential_id = ?")
    .get(response.id) as CredentialRow | undefined;
  if (!row) {
    throw new Error("unknown credential");
  }
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: publicOrigin(),
    expectedRPID: rpId(),
    credential: {
      id: row.credential_id,
      publicKey: new Uint8Array(Buffer.from(row.public_key, "base64url")),
      counter: row.counter,
      transports: row.transports ? JSON.parse(row.transports) : undefined,
    },
  });
  if (!verification.verified) {
    throw new Error("passkey authentication could not be verified");
  }
  getDb()
    .prepare(
      "UPDATE webauthn_credential SET counter = ?, last_used_at = ? WHERE credential_id = ?",
    )
    .run(verification.authenticationInfo.newCounter, nowSec(), row.credential_id);
}
