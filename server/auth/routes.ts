import { readFileSync } from "node:fs";
import path from "node:path";
import express, { type Request, type Response } from "express";
import { loginPage, enrollPage, errorPage, landingPage } from "./pages.js";
import { jwks } from "./keys.js";
import { finalizePendingAuthorization, getPendingAuthorization } from "./provider.js";
import {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  hasCredential,
} from "./webauthn.js";
import { isEnrollmentTokenValid, consumeEnrollmentToken } from "./enrollment.js";
import { clientsStore } from "./clients_store.js";

const BROWSER_BUNDLE = readFileSync(
  path.join(
    import.meta.dirname,
    "..",
    "node_modules",
    "@simplewebauthn",
    "browser",
    "dist",
    "bundle",
    "index.umd.min.js",
  ),
  "utf8",
);

const ASSETS_DIR = path.join(import.meta.dirname, "assets");
const FAVICON_SVG = readFileSync(path.join(ASSETS_DIR, "favicon.svg"), "utf8");
const FAVICON_ICO = readFileSync(path.join(ASSETS_DIR, "favicon.ico"));
const APPLE_TOUCH_ICON = readFileSync(path.join(ASSETS_DIR, "apple-touch-icon.png"));
const ICON_CACHE_CONTROL = "public, max-age=86400";

export function authRoutes(): express.Router {
  const router = express.Router();

  router.get("/assets/webauthn.js", (_req: Request, res: Response) => {
    res.type("application/javascript").send(BROWSER_BUNDLE);
  });

  router.get("/", (_req: Request, res: Response) => {
    res.type("html").send(landingPage());
  });

  router.get("/favicon.svg", (_req: Request, res: Response) => {
    res.type("image/svg+xml").set("Cache-Control", ICON_CACHE_CONTROL).send(FAVICON_SVG);
  });

  router.get("/favicon.ico", (_req: Request, res: Response) => {
    res.type("image/x-icon").set("Cache-Control", ICON_CACHE_CONTROL).send(FAVICON_ICO);
  });

  router.get("/apple-touch-icon.png", (_req: Request, res: Response) => {
    res.type("image/png").set("Cache-Control", ICON_CACHE_CONTROL).send(APPLE_TOUCH_ICON);
  });

  router.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  router.get("/.well-known/jwks.json", async (_req: Request, res: Response) => {
    res.json(await jwks());
  });

  router.get("/login", async (req: Request, res: Response) => {
    const reqId = String(req.query.req ?? "");
    const pending = reqId ? getPendingAuthorization(reqId) : undefined;
    if (!pending) {
      res
        .status(400)
        .type("html")
        .send(errorPage("This sign-in link has expired. Start again from your client."));
      return;
    }
    if (!hasCredential()) {
      res
        .status(400)
        .type("html")
        .send(
          errorPage(
            "No passkey is enrolled yet. Run the enrolment step on the server first.",
          ),
        );
      return;
    }
    const client = await clientsStore.getClient(pending.client_id);
    res.type("html").send(
      loginPage(reqId, {
        clientName: client?.client_name,
        redirectUri: pending.redirect_uri,
      }),
    );
  });

  router.post(
    "/webauthn/authenticate/options",
    express.json(),
    async (req: Request, res: Response) => {
      const reqId = String(req.body?.req ?? "");
      const pending = reqId ? getPendingAuthorization(reqId) : undefined;
      if (!pending) {
        res.status(400).json({ error: "invalid_request" });
        return;
      }
      const { options, challengeId } = await authenticationOptions(reqId);
      res.json({ options, challengeId });
    },
  );

  router.post(
    "/webauthn/authenticate/verify",
    express.json(),
    async (req: Request, res: Response) => {
      try {
        const { req: reqId, challengeId, response } = req.body;
        await verifyAuthentication(challengeId, response, reqId);
        const fin = finalizePendingAuthorization(reqId);
        const url = new URL(fin.redirectUri);
        url.searchParams.set("code", fin.code);
        if (fin.state) {
          url.searchParams.set("state", fin.state);
        }
        res.json({ redirect: url.href });
      } catch {
        res.status(401).json({ error: "authentication_failed" });
      }
    },
  );

  router.get("/enroll", (req: Request, res: Response) => {
    const token = String(req.query.token ?? "");
    if (!token || !isEnrollmentTokenValid(token)) {
      res
        .status(400)
        .type("html")
        .send(errorPage("This enrolment link is invalid or has expired."));
      return;
    }
    res.type("html").send(enrollPage(token));
  });

  router.post(
    "/webauthn/register/options",
    express.json(),
    async (req: Request, res: Response) => {
      const token = req.body?.token;
      if (!isEnrollmentTokenValid(token)) {
        res.status(400).json({ error: "invalid_token" });
        return;
      }
      consumeEnrollmentToken(token);
      const { options, challengeId } = await registrationOptions();
      res.json({ options, challengeId });
    },
  );

  router.post(
    "/webauthn/register/verify",
    express.json(),
    async (req: Request, res: Response) => {
      try {
        const { challengeId, response, label } = req.body;
        await verifyRegistration(challengeId, response, label);
        res.json({ ok: true });
      } catch {
        res.status(400).json({ error: "registration_failed" });
      }
    },
  );

  return router;
}
