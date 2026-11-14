import { Router, type Response } from "express";
import type { InboxMessageDetail, InboxMessageListItem, InboxReplyDraft } from "@vega/domain";
import type { AppConfig } from "../config.js";
import { prisma } from "../prisma.js";
import { getAppSettings } from "../settings/settings-service.js";
import { createConfiguredMailService } from "../mail/configured-mail-service.js";
import { invalidEmail, mailNotConfigured, respondWithSendResult, respondWithStaffEmailStatus, sendStaffEmail } from "../mail/staff-email-service.js";
import { loadSignature } from "../staff/signature-name.js";
import {
  AnalysisError,
  analyzeMessage,
  type CatalogEntry,
  type ServiceCatalogEntry,
} from "./analysis.js";
import {
  GeminiError,
  VertexGeminiClient,
  type GeminiClient,
} from "./gemini-client.js";
import {
  HostingerInboxClient,
  InboxError,
  type HostingerMessage,
  type InboxReader,
  type InboxReplyReader,
} from "./inbox-client.js";
import { loadReplyAllContext } from "./reply-context.js";
import { escapeHtml, mailHtml, mailPlainText } from "./mail-content.js";
import type { MailService } from "../mail/mail-service.js";

const ANALYSES_PER_HOUR = 10;
const INLINE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const MAX_ATTACHMENT_DOWNLOAD = 25 * 1024 * 1024;

export interface InboxRouterDeps {
  inbox: InboxReader | null;
  gemini: GeminiClient | null;
  mailService?: MailService | null;
  loadCatalog?: () => Promise<CatalogEntry[]>;
  loadServiceCatalog?: () => Promise<ServiceCatalogEntry[]>;
  loadBoxVolumes?: () => Promise<{
    box: number | null;
    wardrobeBox: number | null;
  }>;
  now?: () => number;
}

async function loadCatalogFromDb(): Promise<CatalogEntry[]> {
  const rows = await prisma.catalogFurniture.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { categories: { include: { category: true }, take: 1 } },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    volume: Number(row.volume),
    ...(row.categories[0]?.category.name
      ? { category: row.categories[0].category.name }
      : {}),
  }));
}

async function loadServiceCatalogFromDb(): Promise<ServiceCatalogEntry[]> {
  const [services, packings] = await Promise.all([
    prisma.catalogService.findMany({
      select: { id: true, name: true },
      orderBy: [{ sort: "asc" }, { id: "asc" }],
    }),
    prisma.catalogPacking.findMany({
      select: { id: true, name: true },
      orderBy: [{ sort: "asc" }, { id: "asc" }],
    }),
  ]);
  return [
    ...services.map((item) => ({ ...item, kind: "service" as const })),
    ...packings.map((item) => ({ ...item, kind: "packaging" as const })),
  ];
}

function toListItem(message: HostingerMessage): InboxMessageListItem {
  return {
    uid: message.uid,
    subject: message.subject ?? "",
    from: message.from,
    date: message.date,
    unseen: message.unseen,
    attachmentCount: message.attachments.filter((a) => !a.inline).length,
  };
}

function fail(res: Response, status: number, code: string, message: string) {
  res.status(status).json({ error: { code, message } });
}

const ERROR_MESSAGES: Record<string, string> = {
  INBOX_ACCESS_DENIED:
    "Hostinger verweigert den Postfach-Zugriff (403). Bitte HOSTINGER_MAIL_API_TOKEN und HOSTINGER_MAILBOX_RESOURCE_ID prüfen (die Mailbox-ID muss zum Token gehören, siehe GET /api/v1/me).",
  INBOX_UPSTREAM_ERROR:
    "Das Postfach ist beim Mailanbieter gerade nicht erreichbar.",
  INBOX_NETWORK_ERROR: "Der Mailanbieter ist nicht erreichbar.",
  INBOX_TIMEOUT: "Der Mailanbieter hat nicht rechtzeitig geantwortet.",
  INBOX_MESSAGE_NOT_FOUND: "Die Nachricht wurde nicht gefunden.",
  INBOX_ATTACHMENT_TOO_LARGE: "Der Anhang ist zu groß.",
  SOURCE_MAIL_NOT_FOUND:
    "Die Ursprungs-E-Mail wurde im Posteingang nicht gefunden.",
  INBOX_MESSAGE_NO_SENDER: "Für diese Nachricht wurde keine Antwortadresse gefunden.",
  INBOX_BAD_SOURCE: "Der Nachrichtenkopf konnte nicht gelesen werden.",
  GEMINI_AUTH_FAILED:
    "Die Anmeldung bei Google (Vertex AI) ist fehlgeschlagen. Bitte Service-Account und Rolle prüfen.",
  GEMINI_REQUEST_REJECTED:
    "Gemini hat die Anfrage abgelehnt. Bitte Projekt, Region und Modell prüfen.",
  GEMINI_TIMEOUT: "Gemini hat nicht rechtzeitig geantwortet.",
  CATALOG_EMPTY: "Der Möbelkatalog ist leer.",
};

function errorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "Anfrage konnte nicht verarbeitet werden.";
}

function handleError(
  res: Response,
  error: unknown,
  next: (e: unknown) => void,
) {
  if (
    error instanceof InboxError ||
    error instanceof GeminiError ||
    error instanceof AnalysisError
  ) {
    fail(res, error.status, error.code, errorMessage(error.code));
    return;
  }
  next(error);
}

function parseUid(value: unknown): number | null {
  const uid = Number(value);
  return Number.isSafeInteger(uid) && uid > 0 ? uid : null;
}

interface InboxReplyInput {
  subject: string;
  text: string;
  idempotencyKey: string;
}

function validateInboxReplyInput(
  value: unknown,
): { ok: true; value: InboxReplyInput } | { ok: false; issues: Array<{ field: string; message: string }> } {
  const body = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const issues: Array<{ field: string; message: string }> = [];
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!subject || subject.length > 200 || /[\r\n]/u.test(subject)) {
    issues.push({ field: "subject", message: "Der Betreff ist erforderlich (max. 200 Zeichen, einzeilig)." });
  }
  if (!text.trim() || text.length > 100_000) {
    issues.push({ field: "text", message: "Bitte geben Sie eine Nachricht ein (max. 100.000 Zeichen)." });
  }
  if (!/^[A-Za-z0-9-]{16,100}$/u.test(idempotencyKey)) {
    issues.push({ field: "idempotencyKey", message: "Ungültige Versandkennung." });
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: { subject, text, idempotencyKey } };
}

function asReplyInbox(inbox: InboxReader | null): InboxReplyReader | null {
  if (!inbox) return null;
  const candidate = inbox as Partial<InboxReplyReader>;
  return typeof candidate.getSourceHeaders === "function" &&
    typeof candidate.getMailboxAddress === "function"
    ? inbox as InboxReplyReader
    : null;
}

/** Admin-only Postfach: live INBOX reads and Gemini analysis. Nothing from the mail is stored. */
export function createInboxRouter(deps: InboxRouterDeps): Router {
  const router = Router();
  const loadCatalog = deps.loadCatalog ?? loadCatalogFromDb;
  const loadServiceCatalog =
    deps.loadServiceCatalog ?? loadServiceCatalogFromDb;
  const loadBoxVolumes =
    deps.loadBoxVolumes ??
    (async () => {
      const settings = await getAppSettings();
      return { box: settings.boxCbm, wardrobeBox: settings.kleiderboxCbm };
    });
  const now = deps.now ?? Date.now;
  const analysisLog = new Map<string, number[]>();
  let analysisRunning = false;

  router.use((_req, res, next) => {
    if (!deps.inbox) {
      fail(
        res,
        503,
        "MAIL_NOT_CONFIGURED",
        "Das Postfach ist nicht konfiguriert.",
      );
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.get("/status", (_req, res) => {
    res.json({ data: { geminiEnabled: deps.gemini !== null } });
  });

  router.get("/messages", async (req, res, next) => {
    try {
      const page = Math.max(1, Math.min(1000, Number(req.query.page) || 1));
      const perPage = Math.max(
        1,
        Math.min(50, Number(req.query.perPage) || 25),
      );
      const search =
        typeof req.query.search === "string" ? req.query.search : undefined;
      const result = await deps.inbox!.listMessages({
        page,
        perPage,
        ...(search ? { search } : {}),
      });
      res.json({
        data: {
          messages: result.messages.map(toListItem),
          pagination: result.pagination,
        },
      });
    } catch (error) {
      handleError(res, error, next);
    }
  });

  router.get("/messages/:uid", async (req, res, next) => {
    try {
      const uid = parseUid(req.params.uid);
      if (!uid) return fail(res, 400, "INVALID_UID", "Ungültige Nachricht.");
      const [message, content] = await Promise.all([
        deps.inbox!.getMessage(uid),
        deps.inbox!.getText(uid),
      ]);
      const html = mailHtml(content.text, content.html);
      const detail: InboxMessageDetail = {
        ...toListItem(message),
        to: message.to,
        text: mailPlainText(content.text, content.html),
        ...(html ? { html } : {}),
        attachments: message.attachments.map((a) => ({
          id: a.id,
          filename: a.filename ?? a.id,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          inline: a.inline,
        })),
      };
      res.json({ data: detail });
    } catch (error) {
      handleError(res, error, next);
    }
  });

  router.get("/messages/:uid/reply-draft", async (req, res, next) => {
    try {
      const uid = parseUid(req.params.uid);
      if (!uid) return fail(res, 400, "INVALID_UID", "Ungültige Nachricht.");
      const inbox = asReplyInbox(deps.inbox);
      if (!inbox) return fail(res, 503, "INBOX_REPLY_UNAVAILABLE", "Antworten ist für dieses Postfach nicht verfügbar.");
      const reply = await loadReplyAllContext(inbox, uid);
      const draft: InboxReplyDraft = {
        to: reply.to,
        cc: reply.cc,
        subject: reply.subject,
        quoteText: reply.quoteText,
      };
      res.setHeader("Cache-Control", "no-store");
      res.json({ data: draft });
    } catch (error) {
      handleError(res, error, next);
    }
  });

  router.post("/messages/:uid/reply/status", async (req, res, next) => {
    try {
      const uid = parseUid(req.params.uid);
      if (!uid) return fail(res, 400, "INVALID_UID", "Ungültige Nachricht.");
      await respondWithStaffEmailStatus(req, res, `inbox:${uid}`);
    } catch (error) {
      handleError(res, error, next);
    }
  });

  router.post("/messages/:uid/reply", async (req, res, next) => {
    try {
      const uid = parseUid(req.params.uid);
      if (!uid) return fail(res, 400, "INVALID_UID", "Ungültige Nachricht.");
      const mailService = deps.mailService;
      if (!mailService) return mailNotConfigured(res);
      const input = validateInboxReplyInput(req.body);
      if (!input.ok) return invalidEmail(res, input.issues);
      const inbox = asReplyInbox(deps.inbox);
      if (!inbox) return fail(res, 503, "INBOX_REPLY_UNAVAILABLE", "Antworten ist für dieses Postfach nicht verfügbar.");

      const staffUser = res.locals.staffUser as { id: string; name: string };
      const actorName = String(staffUser.name);
      const { outboxId, result } = await sendStaffEmail(
        mailService,
        `inbox:${uid}`,
        input.value.idempotencyKey,
        async () => {
          const [reply, signature] = await Promise.all([
            loadReplyAllContext(inbox, uid),
            loadSignature(String(staffUser.id)),
          ]);
          return {
            kind: "INBOX_REPLY",
            to: reply.to.map((recipient) => recipient.address),
            ...(reply.cc.length ? { cc: reply.cc.map((recipient) => recipient.address) } : {}),
            subject: input.value.subject,
            contentHtml: `<p>${escapeHtml(input.value.text).replace(/\r\n?/gu, "\n").replace(/\n/gu, "<br>")}</p><p></p>${reply.quoteHtml}`,
            replyToMailUid: reply.uid,
            actorName,
            signatureName: signature.signatureName?.trim() || null,
            signatureColor: signature.signatureColor,
          };
        },
      );
      respondWithSendResult(req, res, outboxId, result);
    } catch (error) {
      handleError(res, error, next);
    }
  });

  router.get(
    "/messages/:uid/attachments/:attachmentId",
    async (req, res, next) => {
      try {
        const uid = parseUid(req.params.uid);
        if (!uid) return fail(res, 400, "INVALID_UID", "Ungültige Nachricht.");
        const message = await deps.inbox!.getMessage(uid);
        const attachment = message.attachments.find(
          (a) => a.id === req.params.attachmentId,
        );
        if (!attachment)
          return fail(
            res,
            404,
            "ATTACHMENT_NOT_FOUND",
            "Anhang nicht gefunden.",
          );
        const buffer = await deps.inbox!.downloadAttachment(
          uid,
          attachment.id,
          MAX_ATTACHMENT_DOWNLOAD,
        );
        const type = attachment.contentType.toLowerCase();
        const inline = INLINE_IMAGE_TYPES.has(type);
        const safeName = (attachment.filename ?? "anhang")
          .replace(/[^\w.\- ]+/gu, "_")
          .slice(0, 120);
        res.setHeader(
          "Content-Type",
          inline ? type : "application/octet-stream",
        );
        res.setHeader(
          "Content-Disposition",
          `${inline ? "inline" : "attachment"}; filename="${safeName}"`,
        );
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader(
          "Content-Security-Policy",
          "sandbox; default-src 'none'; img-src 'self'",
        );
        res.send(buffer);
      } catch (error) {
        handleError(res, error, next);
      }
    },
  );

  router.post("/messages/:uid/analyze", async (req, res, next) => {
    if (!deps.gemini)
      return fail(
        res,
        503,
        "GEMINI_NOT_CONFIGURED",
        "Die KI-Analyse ist nicht aktiviert.",
      );
    const uid = parseUid(req.params.uid);
    if (!uid) return fail(res, 400, "INVALID_UID", "Ungültige Nachricht.");
    const userId = String(res.locals.staffUser?.id ?? "unknown");
    const current = now();
    const recent = (analysisLog.get(userId) ?? []).filter(
      (t) => current - t < 3_600_000,
    );
    if (recent.length >= ANALYSES_PER_HOUR) {
      return fail(
        res,
        429,
        "ANALYSIS_RATE_LIMITED",
        "Zu viele Analysen. Bitte später erneut versuchen.",
      );
    }
    if (analysisRunning) {
      return fail(res, 429, "ANALYSIS_BUSY", "Es läuft bereits eine Analyse.");
    }
    analysisRunning = true;
    analysisLog.set(userId, [...recent, current]);
    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const result = await analyzeMessage(
        {
          inbox: deps.inbox!,
          gemini: deps.gemini!,
          loadCatalog,
          loadServiceCatalog,
          loadBoxVolumes,
        },
        uid,
        controller.signal,
      );
      res.json({ data: result });
    } catch (error) {
      handleError(res, error, next);
    } finally {
      analysisRunning = false;
    }
  });

  router.post("/messages/:uid/link-order", async (req, res, next) => {
    try {
      const uid = parseUid(req.params.uid);
      const orderNumber = Number(req.body?.orderNumber);
      if (!uid || !Number.isSafeInteger(orderNumber) || orderNumber <= 0) {
        return fail(res, 400, "INVALID_INPUT", "Ungültige Eingabe.");
      }
      const message = await deps.inbox!.getMessage(uid);
      if (!message.messageId) {
        return fail(
          res,
          409,
          "MESSAGE_ID_MISSING",
          "Die Nachricht hat keine Message-ID.",
        );
      }
      const order = await prisma.order.findUnique({
        where: { orderNumber },
        select: { orderNumber: true },
      });
      if (!order)
        return fail(res, 404, "ORDER_NOT_FOUND", "Auftrag nicht gefunden.");
      await prisma.order.update({
        where: { orderNumber },
        data: {
          sourceMailUid: uid,
          sourceMessageId: message.messageId.slice(0, 998),
        },
      });
      res.json({ data: { linked: true } });
    } catch (error) {
      handleError(res, error, next);
    }
  });

  return router;
}

export function createConfiguredInboxRouter(
  config: Pick<AppConfig, "mail" | "gemini">,
): Router {
  return createInboxRouter({
    inbox: config.mail ? new HostingerInboxClient(config.mail) : null,
    gemini: config.gemini ? new VertexGeminiClient(config.gemini) : null,
    mailService: createConfiguredMailService(config),
  });
}
