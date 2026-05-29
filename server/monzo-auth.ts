import crypto from "node:crypto";
import { exec, spawn } from "node:child_process";
import http from "node:http";
import { exchangeMonzoCode } from "./connectors/monzo/tokens.js";

const PORT = Number(process.env.MONZO_REDIRECT_PORT ?? 51789);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const clientId = process.env.MONZO_CLIENT_ID ?? process.argv[2];
const clientSecret = process.env.MONZO_CLIENT_SECRET ?? process.argv[3];

if (!clientId || !clientSecret) {
  console.error("Usage: MONZO_CLIENT_ID=... MONZO_CLIENT_SECRET=... npm run monzo:auth");
  console.error(
    `Register a confidential client at https://developers.monzo.com with redirect URL: ${REDIRECT_URI}`,
  );
  process.exit(1);
}

const expectedState = crypto.randomBytes(16).toString("hex");
const authUrl = `https://auth.monzo.com/?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT_URI,
  response_type: "code",
  state: expectedState,
}).toString()}`;

function waitForCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out after 2 minutes waiting for the Monzo callback."));
    }, 120_000);
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        "<html><body style='font-family:system-ui;padding:2rem'>Monzo authorised. Close this tab and return to the app.</body></html>",
      );
      clearTimeout(timeout);
      server.close();
      if (returnedState !== expectedState) {
        reject(new Error("State mismatch in Monzo callback — aborting for safety."));
        return;
      }
      if (!code) {
        reject(new Error("Monzo callback did not include an authorization code."));
        return;
      }
      resolve(code);
    });
    server.on("error", reject);
    server.listen(PORT, "127.0.0.1");
  });
}

function copyToClipboard(text: string): void {
  const pb = spawn("pbcopy");
  pb.on("error", () => {});
  pb.stdin.write(text);
  pb.stdin.end();
}

async function main(): Promise<void> {
  console.error("Opening Monzo authorisation in your browser...");
  console.error(`If it does not open, visit:\n${authUrl}\n`);
  exec(`open "${authUrl}"`);

  const code = await waitForCode();
  console.error("Exchanging the authorization code for tokens...");
  const tokens = await exchangeMonzoCode(fetch, {
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    code,
  });

  const blob = JSON.stringify({
    client_id: clientId,
    client_secret: clientSecret,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });

  copyToClipboard(blob);
  console.error(
    "\nDone. The result is on your clipboard. Approve access in your Monzo app, then paste it into the Connect Monzo widget within ~5 minutes to capture full history:\n",
  );
  console.log(blob);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
