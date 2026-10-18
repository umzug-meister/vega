import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { pinoHttp, type Options as HttpLogOptions } from "pino-http";
import { APIError } from "better-auth/api";
import { fromNodeHeaders, toNodeHandler } from "better-auth/node";
import { isValidEmailAddress } from "@vega/domain";
import { createAuth } from "./auth-config.js";
import { requireAdmin, requireCompletedStaff } from "./auth-middleware.js";
import {
  createAdminRateLimit,
  createAssetRateLimit,
  createProfileEmailRateLimit,
} from "./http-rate-limit.js";
import type { AppConfig } from "./config.js";
import { prisma } from "./prisma.js";
import {
  meetsPasswordPolicy,
  PASSWORD_POLICY_MESSAGE,
} from "./password-policy.js";
import { createOrderRouter } from "./orders/order-routes.js";
import { createCatalogRouter } from "./catalog/catalog-routes.js";
import { createAdminOrderRouter } from "./orders/admin-order-routes.js";
import { createCreditNoteRouter } from "./invoices/credit-note-routes.js";
import { createInvoiceRouter } from "./invoices/invoice-routes.js";
import { createReminderRouter } from "./invoices/reminder-routes.js";
import { createUploadRouter } from "./uploads/upload-routes.js";
import { createUploadService, UploadError } from "./uploads/upload-service.js";
import { createCustomerFormRouter } from "./customer-form-routes.js";
import { createSettingsRouter } from "./settings/settings-routes.js";
import { createMaintenanceRouter } from "./maintenance/maintenance-routes.js";
import { createRouteRouter } from "./maps/route-routes.js";
import { createAdminPlacesRouter } from "./maps/admin-places-routes.js";
import { createStaffRouter } from "./staff/staff-routes.js";
import {
  loadSignatureName,
  validateSignatureName,
} from "./staff/signature-name.js";

const adminBuild = fileURLToPath(new URL("../../admin/dist", import.meta.url));
const customerFormBuild = fileURLToPath(
  new URL("../../customer-form/dist", import.meta.url),
);

export function createApp(
  config: AppConfig,
  dependencies: {
    auth?: ReturnType<typeof createAuth>;
    logStream?: HttpLogOptions["stream"];
  } = {},
) {
  const app = express();
  // Operator-approved single-hop assumption; limitations: docs/operations.md.
  app.set("trust proxy", 1);
  const auth = dependencies.auth ?? createAuth(config);
  app.disable("x-powered-by");

  app.use((req, res, next) => {
    const requestId = randomUUID();
    res.setHeader("X-Request-ID", requestId);
    res.locals.requestId = requestId;
    next();
  });
  app.use(
    pinoHttp(
      {
        customProps: (_req, res) => ({ requestId: res.locals.requestId }),
        genReqId: (_req, res) => String(res.locals.requestId),
        serializers: {
          req: (req) => ({
            id: req.id,
            method: req.method,
            url: safeRequestPath(String(req.url ?? "")),
          }),
          res: (res) => ({ statusCode: res.statusCode }),
          // Error messages, stacks and enumerable properties can contain submitted
          // JSON, Prisma query arguments or provider credentials.
          err: () => ({ type: "Error" }),
        },
      },
      dependencies.logStream,
    ),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          connectSrc: [
            "'self'",
            ...(config.gcs ? ["https://storage.googleapis.com"] : []),
          ],
          fontSrc: ["'self'", "data:"],
          formAction: ["'self'"],
          frameAncestors: ["'none'"],
          imgSrc: [
            "'self'",
            "data:",
            "blob:",
            ...(config.gcs ? ["https://storage.googleapis.com"] : []),
          ],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        // Requests without an Origin (e.g. health probes) are not browser CORS requests.
        callback(
          null,
          origin === undefined || config.corsAllowedOrigins.includes(origin),
        );
      },
    }),
  );

  // Better Auth must receive the unconsumed request stream before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ status: "ok", service: "vega" });
  });

  app.get("/api/admin/session", async (req, res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        res
          .status(401)
          .json({
            error: {
              code: "UNAUTHENTICATED",
              message: "Bitte melden Sie sich an.",
            },
          });
        return;
      }

      res.setHeader("Cache-Control", "no-store");
      res.json({
        data: {
          user: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
            role: session.user.role,
            mustChangePassword: session.user.mustChangePassword,
            twoFactorEnabled: session.user.twoFactorEnabled,
            blocked: session.user.blocked,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.use(createOrderRouter(auth, config));
  app.use(createCatalogRouter(auth, config));
  app.use("/api/customer-form", createCustomerFormRouter(config));
  app.use("/api/public/uploads", createUploadRouter(config));

  app.post("/api/admin/auth/initial-password", async (req, res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        res
          .status(401)
          .json({
            error: {
              code: "UNAUTHENTICATED",
              message: "Bitte melden Sie sich an.",
            },
          });
        return;
      }
      if (!session.user.mustChangePassword) {
        res
          .status(409)
          .json({
            error: {
              code: "PASSWORD_CHANGE_NOT_REQUIRED",
              message: "Ein initialer Passwortwechsel ist nicht erforderlich.",
            },
          });
        return;
      }
      if (session.user.blocked) {
        res
          .status(403)
          .json({
            error: {
              code: "ACCOUNT_BLOCKED",
              message: "Dieses Konto ist gesperrt.",
            },
          });
        return;
      }

      const body = req.body as {
        currentPassword?: unknown;
        newPassword?: unknown;
      };
      if (
        typeof body?.currentPassword !== "string" ||
        typeof body.newPassword !== "string" ||
        !meetsPasswordPolicy(body.newPassword) ||
        body.currentPassword === body.newPassword
      ) {
        res
          .status(400)
          .json({
            error: {
              code: "INVALID_PASSWORD",
              message: `${PASSWORD_POLICY_MESSAGE} Das neue Passwort muss sich außerdem vom Initialpasswort unterscheiden.`,
            },
          });
        return;
      }

      let passwordChangeHeaders: Headers;
      try {
        const changed = await auth.api.changePassword({
          body: {
            currentPassword: body.currentPassword,
            newPassword: body.newPassword,
            revokeOtherSessions: true,
          },
          headers: fromNodeHeaders(req.headers),
          returnHeaders: true,
        });
        passwordChangeHeaders = changed.headers;
      } catch (error) {
        if (!(error instanceof APIError) || error.statusCode >= 500)
          throw error;
        res
          .status(400)
          .json({
            error: {
              code: "PASSWORD_CHANGE_FAILED",
              message: "Das Passwort konnte nicht geändert werden.",
            },
          });
        return;
      }

      await prisma.user.update({
        where: { id: session.user.id },
        data: { mustChangePassword: false },
      });
      // changePassword revokes every old session and issues a replacement.
      // Forward its cookies so the confirmed browser can continue TOTP setup.
      for (const cookie of passwordChangeHeaders.getSetCookie())
        res.append("Set-Cookie", cookie);
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: { passwordChanged: true } });
    } catch (error) {
      next(error);
    }
  });

  // Every future admin API is denied until the password and mandatory TOTP setup are complete.
  // The per-staff limiter runs after authentication so anonymous requests keep
  // their 401/403 responses and only completed staff consume quota.
  app.use("/api/admin", requireCompletedStaff(auth));
  app.use("/api/admin", createAdminRateLimit());
  app.use(
    "/api/admin/maintenance",
    requireAdmin(auth),
    createMaintenanceRouter(config, customerFormBuild),
  );
  app.use(
    "/api/admin/settings",
    requireAdmin(auth),
    createSettingsRouter(config),
  );
  app.use(
    "/api/admin/staff",
    requireAdmin(auth),
    createStaffRouter(auth, config),
  );
  app.use("/api/admin/places", createAdminPlacesRouter(config));
  app.use("/api/admin/routes", createRouteRouter(config));
  app.get("/api/admin/orders/:orderNumber/images", async (req, res, next) => {
    try {
      const orderNumber = Number(req.params.orderNumber);
      if (!Number.isSafeInteger(orderNumber) || orderNumber < 1)
        return res
          .status(400)
          .json({
            error: {
              code: "INVALID_ORDER_NUMBER",
              message: "Ungültige Auftragsnummer.",
            },
          });
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: { id: true },
      });
      if (!order)
        return res
          .status(404)
          .json({
            error: {
              code: "ORDER_NOT_FOUND",
              message: "Auftrag nicht gefunden.",
            },
          });
      const uploads = createUploadService(config);
      if (!uploads)
        return res
          .status(503)
          .json({
            error: {
              code: "UPLOADS_UNAVAILABLE",
              message: "Der Bildspeicher ist noch nicht eingerichtet.",
            },
          });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ data: await uploads.list(order.id) });
    } catch (error) {
      if (error instanceof UploadError) {
        req.log.warn({ code: error.code }, "image storage read failed");
        return res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message } });
      }
      next(error);
      return;
    }
  });
  app.use("/api/admin/orders", createAdminOrderRouter(config));
  app.use(
    "/api/admin/invoices",
    requireAdmin(auth),
    createInvoiceRouter(config),
  );
  app.use(
    "/api/admin/credits",
    requireAdmin(auth),
    createCreditNoteRouter(config),
  );
  app.use(
    "/api/admin/reminders",
    requireAdmin(auth),
    createReminderRouter(config),
  );

  app.get("/api/admin/profile/signature", async (_req, res, next) => {
    try {
      const staffUser = res.locals.staffUser as { id: string };
      res.setHeader("Cache-Control", "no-store");
      res.json({
        data: { signatureName: await loadSignatureName(staffUser.id) },
      });
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/admin/profile/signature", async (req, res, next) => {
    try {
      const input = validateSignatureName(
        (req.body as { signatureName?: unknown } | undefined)?.signatureName,
      );
      if (!input.ok) {
        res
          .status(400)
          .json({
            error: { code: "INVALID_SIGNATURE_NAME", message: input.message },
          });
        return;
      }
      const staffUser = res.locals.staffUser as { id: string };
      await prisma.user.update({
        where: { id: staffUser.id },
        data: { signatureName: input.value },
      });
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: { signatureName: input.value } });
    } catch (error) {
      next(error);
    }
  });

  app.post(
    "/api/admin/profile/email",
    createProfileEmailRateLimit(),
    async (req, res, next) => {
      try {
        const origin = req.headers.origin;
        if (
          origin !== undefined &&
          !config.betterAuthTrustedOrigins.includes(origin)
        ) {
          res
            .status(403)
            .json({
              error: {
                code: "INVALID_ORIGIN",
                message: "Ungültige Anfrage-Origin.",
              },
            });
          return;
        }
        const body = req.body as { email?: unknown; currentPassword?: unknown };
        const email =
          typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
        if (
          !isValidEmail(email) ||
          typeof body.currentPassword !== "string" ||
          body.currentPassword.length === 0
        ) {
          res
            .status(400)
            .json({
              error: {
                code: "INVALID_EMAIL_CHANGE",
                message:
                  "Bitte geben Sie eine gültige E-Mail-Adresse und Ihr aktuelles Passwort ein.",
              },
            });
          return;
        }

        const headers = fromNodeHeaders(req.headers);
        try {
          await auth.api.verifyPassword({
            body: { password: body.currentPassword },
            headers,
          });
        } catch (error) {
          if (!(error instanceof APIError) || error.statusCode >= 500)
            throw error;
          res
            .status(400)
            .json({
              error: {
                code: "PASSWORD_CONFIRMATION_FAILED",
                message: "Das aktuelle Passwort ist nicht korrekt.",
              },
            });
          return;
        }

        const staffUser = res.locals.staffUser as { id: string; email: string };
        if (staffUser.email.toLowerCase() === email) {
          res
            .status(409)
            .json({
              error: {
                code: "EMAIL_UNCHANGED",
                message: "Diese E-Mail-Adresse ist bereits hinterlegt.",
              },
            });
          return;
        }
        try {
          await prisma.user.update({
            where: { id: staffUser.id },
            data: { email },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            res
              .status(409)
              .json({
                error: {
                  code: "EMAIL_ALREADY_IN_USE",
                  message: "Diese E-Mail-Adresse wird bereits verwendet.",
                },
              });
            return;
          }
          throw error;
        }
        // A mail-address change affects a recovery factor: retain only the current confirmed session.
        await auth.api.revokeOtherSessions({ headers });
        res.setHeader("Cache-Control", "no-store");
        res.json({ data: { email } });
      } catch (error) {
        next(error);
      }
    },
  );

  // Loader, static builds, and SPA entry routes touch the filesystem on every
  // request. The IP-keyed limiter keeps repeated asset fetching from becoming
  // a local availability vector without changing assets or loader contracts.
  const assetRateLimit = createAssetRateLimit();
  app.get(
    "/customer-form/loader.js",
    assetRateLimit,
    async (_req, res, next) => {
      try {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        const manifestPath = `${customerFormBuild}/.vite/manifest.json`;
        if (!existsSync(manifestPath))
          return res
            .status(503)
            .type("text/javascript")
            .send(
              'throw new Error("Vega customer form build is unavailable");',
            );
        const manifest = JSON.parse(
          await readFile(manifestPath, "utf8"),
        ) as Record<
          string,
          { isEntry?: boolean; file: string; css?: string[] }
        >;
        const entry = Object.values(manifest).find((item) => item.isEntry);
        if (!entry) throw new Error("CUSTOMER_FORM_ENTRY_MISSING");
        const base = new URL("/customer-form/", config.appBaseUrl);
        const asset = new URL(entry.file, base).href;
        const css = (entry.css ?? []).map((file) => new URL(file, base).href);
        res.type("text/javascript").send(`(() => {
const script = document.currentScript;
if (!script) throw new Error("Vega loader must be loaded as a script");
const target = script.dataset.target ? document.getElementById(script.dataset.target) : null;
const root = target || document.createElement("div");
root.id = "vega-customer-form";
root.dataset.apiBase = ${JSON.stringify(config.appBaseUrl.origin)};
if (!target) script.after(root);
for (const href of ${JSON.stringify(css)}) {
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = href; document.head.append(link);
}
import(${JSON.stringify(asset)}).catch(() => { root.textContent = "Das Umzugsformular konnte nicht geladen werden. Bitte laden Sie die Seite erneut."; });
})();`);
        return;
      } catch (error) {
        next(error);
      }
    },
  );
  app.use(
    "/customer-form",
    assetRateLimit,
    (_req, res, next) => {
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      next();
    },
    express.static(customerFormBuild, { index: false, fallthrough: true }),
  );
  app.get(/^\/customer-form\/?$/, assetRateLimit, (_req, res, next) => {
    if (!existsSync(`${customerFormBuild}/index.html`)) return next();
    return res.sendFile(`${customerFormBuild}/index.html`);
  });

  app.use(
    assetRateLimit,
    express.static(adminBuild, { index: false, fallthrough: true }),
  );
  app.get("/", assetRateLimit, async (req, res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (!session) {
        res.redirect(302, "/login");
        return;
      }
      if (!existsSync(`${adminBuild}/index.html`)) return next();
      res.sendFile(`${adminBuild}/index.html`);
    } catch (error) {
      next(error);
    }
  });
  app.get("/login", assetRateLimit, async (req, res, next) => {
    try {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
      });
      if (session) {
        res.redirect(302, "/");
        return;
      }
      if (!existsSync(`${adminBuild}/index.html`)) return next();
      res.sendFile(`${adminBuild}/index.html`);
    } catch (error) {
      next(error);
    }
  });
  app.get("/two-factor", assetRateLimit, (_req, res, next) => {
    if (!existsSync(`${adminBuild}/index.html`)) return next();
    res.sendFile(`${adminBuild}/index.html`);
  });
  app.get(
    ["/forgot-password", "/reset-password", "/maintenance"],
    assetRateLimit,
    (_req, res, next) => {
      if (!existsSync(`${adminBuild}/index.html`)) return next();
      return res.sendFile(`${adminBuild}/index.html`);
    },
  );
  app.get(/^\/admin\/?$/, assetRateLimit, (_req, res) =>
    res.redirect(302, "/"),
  );

  app.get(
    /^(?!\/api(?:\/|$))(?!\/health(?:\/|$))(?!\/customer-form(?:\/|$))(?!\/assets(?:\/|$)).*/,
    assetRateLimit,
    (req, res, next) => {
      if (!req.accepts("html") || !existsSync(`${adminBuild}/index.html`))
        return next();
      res.status(404).sendFile(`${adminBuild}/index.html`);
    },
  );

  app.use((_req, res) => {
    res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "Route nicht gefunden." } });
  });

  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    const requestId = String(res.locals.requestId ?? "unbekannt");
    const failure = requestFailure(error);
    const metadata = {
      code: failure.code,
      statusCode: failure.status,
      requestId,
    };
    if (failure.status < 500) req.log.warn(metadata, "request rejected");
    else req.log.error(metadata, "request failed");
    res.status(failure.status).json({
      error: { code: failure.code, message: failure.message, requestId },
    });
  };
  app.use(errorHandler);

  return app;
}

function safeRequestPath(url: string): string {
  const path = url.split(/[?#]/u, 1)[0] ?? "";
  return path.replace(/^(\/api\/auth\/reset-password\/)[^/]+/u, "$1[redacted]");
}

function requestFailure(error: unknown): {
  status: number;
  code: string;
  message: string;
} {
  const type =
    typeof error === "object" && error !== null && "type" in error
      ? error.type
      : undefined;
  switch (type) {
    case "entity.parse.failed":
      return {
        status: 400,
        code: "INVALID_JSON",
        message: "Ungültige JSON-Anfrage.",
      };
    case "entity.too.large":
      return {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: "Die Anfrage ist zu groß.",
      };
    case "encoding.unsupported":
    case "charset.unsupported":
      return {
        status: 415,
        code: "UNSUPPORTED_ENCODING",
        message: "Die Zeichen- oder Inhaltskodierung wird nicht unterstützt.",
      };
    case "request.aborted":
    case "request.size.invalid":
      return {
        status: 400,
        code: "INVALID_REQUEST",
        message: "Die Anfrage ist unvollständig oder ungültig.",
      };
    default:
      return {
        status: 500,
        code: "INTERNAL_SERVER_ERROR",
        message: "Interner Serverfehler.",
      };
  }
}

function isValidEmail(value: string): boolean {
  return isValidEmailAddress(value);
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2002"
  );
}
