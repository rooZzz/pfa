function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set. Add it to server/.env and restart the server.`);
  }
  return value;
}

export function authConfigured(): boolean {
  return Boolean(process.env.PUBLIC_ORIGIN?.trim());
}

export const publicOrigin = (): string => required("PUBLIC_ORIGIN");
export const rpId = (): string => required("RP_ID");
export const rpName = (): string => process.env.RP_NAME?.trim() || "pfa";
export const mcpResource = (): string => required("MCP_RESOURCE");
export const authorizedSubject = (): string => required("AUTHORIZED_SUBJECT");
export const signingKeyPath = (): string => required("SIGNING_KEY_PATH");

export const authPort = (): number => Number(process.env.AUTH_PORT ?? 4001);
export const accessTokenTtl = (): number => Number(process.env.ACCESS_TOKEN_TTL ?? 1800);
export const refreshTokenTtl = (): number =>
  Number(process.env.REFRESH_TOKEN_TTL ?? 5184000);

export function publicOriginHost(): string {
  return new URL(publicOrigin()).host;
}
