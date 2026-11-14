import { Router } from "express";
import type { AppConfig } from "../config.js";
import { createAdminRateLimit } from "../http-rate-limit.js";
import { GEMINI_TIMEOUT_MS } from "../inbox/gemini-client.js";
import { clientAbortSignal, PROVIDER_TIMEOUT_MS } from "../maps/provider-request.js";
import { runSetupSmokeTest, setupInfo } from "./maintenance-service.js";

export function createMaintenanceRouter(config: AppConfig, buildDirectory: string) {
  const router = Router();
  const info = setupInfo(config);
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/", (_req, res) => { res.json({ data: info }); });
  router.post("/smoke-test", (req, res, next) => {
    if (req.headers.origin !== undefined && !config.betterAuthTrustedOrigins.includes(req.headers.origin)) {
      res.status(403).json({ error: { code: "INVALID_ORIGIN", message: "Ungültige Anfrage-Origin." } });
      return;
    }
    next();
  }, createAdminRateLimit({ max: 2 }), async (req, res, next) => {
    try {
      const signal = AbortSignal.any([clientAbortSignal(res), AbortSignal.timeout(GEMINI_TIMEOUT_MS)]);
      const result = await runSetupSmokeTest(config, buildDirectory, signal);
      for (const check of result.checks) {
        if (check.status === "error") req.log.warn({ code: "SETUP_CHECK_FAILED", check: check.id }, "setup smoke test failed");
      }
      res.json({ data: result });
    } catch (error) { next(error); }
  });
  return router;
}
