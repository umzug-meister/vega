import { needsTotpSetup } from "@vega/domain";
import { Router } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { createAuth } from "../auth-config.js";
import type { AppConfig } from "../config.js";
import { createOrder } from "./order-service.js";
import { consumePublicApiRateLimit } from "../public-rate-limit.js";
import {
  OrderInputError,
  validateCustomerFormInput,
  validateOrderCreateInput,
} from "./order-input.js";
import { createConfiguredMailService } from "../mail/configured-mail-service.js";
import { deliverOutboxMail } from "../mail/mail-outbox-service.js";
import { UploadError } from "../uploads/upload-service.js";
import { getAppSettings } from "../settings/settings-service.js";
import {
  orderPricingErrorIssue,
  PricePreviewStaleError,
} from "./order-pricing-service.js";

type AuthInstance = ReturnType<typeof createAuth>;

export function createOrderRouter(auth: AuthInstance, config: AppConfig) {
  const router = Router();

  // This is deliberately the only order write API callable without staff auth.
  // No order/customer read access is exposed by this router.
  router.post(["/api/orders", "/api/public/orders"], async (req, res, next) => {
    try {
      const session =
        req.path === "/api/public/orders"
          ? null
          : await auth.api.getSession({
              headers: fromNodeHeaders(req.headers),
            });
      if (session) {
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
        if (session.user.mustChangePassword || needsTotpSetup(session.user)) {
          res
            .status(403)
            .json({
              error: {
                code: "STAFF_SETUP_REQUIRED",
                message: "Bitte schließen Sie zuerst die Kontoeinrichtung ab.",
              },
            });
          return;
        }
        if (
          session.user.role !== "Admin" &&
          session.user.role !== "Kundenberater"
        ) {
          res
            .status(403)
            .json({
              error: {
                code: "FORBIDDEN",
                message: "Für diese Aktion fehlen die Berechtigungen.",
              },
            });
          return;
        }
      } else if (
        !(await consumePublicApiRateLimit(
          req.ip ?? req.socket.remoteAddress ?? "unknown",
          config.betterAuthSecret,
          "order-create",
          10,
        ))
      ) {
        res.setHeader(
          "Retry-After",
          String(60 - (Math.floor(Date.now() / 1000) % 60)),
        );
        res
          .status(429)
          .json({
            error: {
              code: "RATE_LIMITED",
              message:
                "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
            },
          });
        return;
      }

      const validation = validateOrderCreateInput(req.body, {
        allowStaffPricing: session !== null,
        allowIncomplete: session !== null,
      });
      if (!validation.ok) {
        res.status(400).json({
          error: {
            code: "INVALID_ORDER",
            message: "Bitte prüfen Sie die markierten Auftragsdaten.",
            issues: validation.issues,
          },
        });
        return;
      }
      const settings = await getAppSettings();
      if (!session) {
        const input = validation.value;
        if (!settings.dataPrivacyUrl) {
          res
            .status(503)
            .json({
              error: {
                code: "CUSTOMER_FORM_NOT_CONFIGURED",
                message:
                  "Die Datenschutzerklärung ist noch nicht konfiguriert.",
              },
            });
          return;
        }
        const issues = validateCustomerFormInput(input);
        if (issues.length) {
          res
            .status(400)
            .json({
              error: {
                code: "INCOMPLETE_CUSTOMER_FORM",
                message:
                  "Bitte vervollständigen Sie das Formular und bestätigen Sie die Datenschutzerklärung.",
                issues,
              },
            });
          return;
        }
        if (input.details)
          input.details.basis = {
            workers: 0,
            trucks: 0,
            hours: 0,
            basePrice: 0,
            extraHourPrice: 0,
            discountPercent: 0,
          };
      }

      const orderInput = session
        ? {
            ...validation.value,
            orderSource: validation.value.orderSource ?? "individuelle",
          }
        : { ...validation.value, orderSource: "umzugruckzuck24.de" as const };
      const created = await createOrder(
        orderInput,
        session ? "admin" : "public",
        session?.user.name ?? "-",
        settings,
      );
      const mailService = createConfiguredMailService(config);
      if (mailService)
        for (const outboxId of created.outboxIds) {
          void deliverOutboxMail(outboxId, mailService).catch(
            (error: unknown) => {
              // Never log recipient, subject, content, attachments, token, or provider body.
              req.log.warn(
                {
                  outboxId,
                  code:
                    error instanceof Error ? error.message : "MAIL_SEND_FAILED",
                },
                "inquiry receipt delivery failed",
              );
            },
          );
        }
      res.setHeader("Cache-Control", "no-store");
      res.status(201).json({ data: { orderNumber: created.orderNumber } });
    } catch (error) {
      if (error instanceof OrderInputError) {
        res
          .status(400)
          .json({
            error: {
              code: "INVALID_ORDER",
              message: "Bitte prüfen Sie die markierten Auftragsdaten.",
              issues: error.issues,
            },
          });
        return;
      }
      if (error instanceof UploadError) {
        res
          .status(error.status)
          .json({ error: { code: error.code, message: error.message } });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "INVALID_ORDER_CATALOG_REFERENCE"
      ) {
        res
          .status(400)
          .json({
            error: {
              code: "INVALID_ORDER_CATALOG_REFERENCE",
              message:
                "Eine ausgewählte Katalogposition ist nicht mehr verfügbar.",
            },
          });
        return;
      }
      const pricingIssue = orderPricingErrorIssue(error);
      if (pricingIssue) {
        res
          .status(400)
          .json({
            error: {
              code: "INVALID_ORDER",
              message: pricingIssue.message,
              issues: [pricingIssue],
            },
          });
        return;
      }
      if (error instanceof Error && error.message === "PRICE_CATALOG_CHANGED") {
        res
          .status(409)
          .json({
            error: {
              code: "PRICE_CATALOG_CHANGED",
              message:
                "Der Preiskatalog wurde seit der Vorschau geändert. Bitte berechnen Sie das Angebot erneut.",
            },
          });
        return;
      }
      if (error instanceof PricePreviewStaleError) {
        res
          .status(409)
          .json({
            error: {
              code: "PRICE_PREVIEW_STALE",
              message:
                "Preisrelevante Angaben wurden seit der Vorschau geändert. Bitte berechnen Sie das Angebot erneut.",
              changedFields: error.changedFields,
            },
          });
        return;
      }
      next(error);
    }
  });

  return router;
}
