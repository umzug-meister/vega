import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { prisma } from "../prisma.js";
import {
  HOSTINGER_MAIL_TIMEOUT_MS,
  MailDeliveryError,
  type MailAttachment,
} from "./hostinger-mail-client.js";
import type { EmailKind, MailService } from "./mail-service.js";
import type { SignatureColor } from "../staff/signature-name.js";

export interface QueueMailInput {
  orderId?: string;
  /** Partner order of a two-option offer; gets a journal entry once the mail is SENT. */
  optionOrderId?: string;
  /** Payment reminder whose `sentAt` is set once this mail is SENT. */
  reminderEventId?: string;
  kind: Exclude<EmailKind, "PASSWORD_RESET">;
  to: string[];
  subject: string;
  contentHtml: string;
  attachments?: MailAttachment[];
  actorName?: string;
  signatureName?: string | null;
  signatureColor?: SignatureColor;
  idempotencyKey: string;
}

/** Stores mail before delivery. It deliberately contains no password-reset token. */
export async function queueMail(input: QueueMailInput): Promise<string> {
  const create = {
    id: randomUUID(),
    ...(input.orderId ? { orderId: input.orderId } : {}),
    ...(input.optionOrderId ? { optionOrderId: input.optionOrderId } : {}),
    ...(input.reminderEventId
      ? { reminderEventId: input.reminderEventId }
      : {}),
    kind: input.kind,
    recipients: input.to as Prisma.InputJsonValue,
    subject: input.subject,
    contentHtml: input.contentHtml,
    ...(input.attachments
      ? { attachments: input.attachments as unknown as Prisma.InputJsonValue }
      : {}),
    ...(input.actorName ? { actorName: input.actorName } : {}),
    ...(input.signatureName ? { signatureName: input.signatureName } : {}),
    ...(input.signatureColor ? { signatureColor: input.signatureColor } : {}),
    idempotencyKey: input.idempotencyKey,
    nextAttemptAt: new Date(),
  };
  try {
    const row = await prisma.emailOutbox.upsert({
      where: { idempotencyKey: input.idempotencyKey },
      create,
      update: {},
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    // Two concurrent requests with the same key: the loser reuses the winner's row.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.emailOutbox.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
    throw error;
  }
}

// Leave room for preflight, provider timeout and the short final DB transaction.
export const MAIL_SENDING_STALE_MS = HOSTINGER_MAIL_TIMEOUT_MS + 60_000;

export async function recoverStaleMailClaims(
  now = new Date(),
  id?: string,
): Promise<number> {
  const result = await prisma.emailOutbox.updateMany({
    where: {
      ...(id ? { id } : {}),
      status: "SENDING",
      OR: [
        { lockedAt: { lte: new Date(now.getTime() - MAIL_SENDING_STALE_MS) } },
        { lockedAt: null },
      ],
    },
    data: { status: "UNKNOWN", lastErrorCode: "MAIL_STALE_SENDING" },
  });
  return result.count;
}

export async function deliverOutboxMail(
  id: string,
  mailService: MailService,
): Promise<"sent" | "not-claimed"> {
  await recoverStaleMailClaims(new Date(), id);
  const lockedAt = new Date();
  const claimed = await prisma.emailOutbox.updateMany({
    where: {
      id,
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: new Date() },
    },
    data: {
      status: "SENDING",
      lockedAt,
      attempts: { increment: 1 },
      lastErrorCode: null,
    },
  });
  if (claimed.count !== 1) return "not-claimed";

  let sendStarted = false;
  try {
    const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });
    const signatureColor: SignatureColor =
      row.signatureColor === "#28527A"
        ? "#28527A"
        : row.signatureColor === "#CB722F"
          ? "#CB722F"
          : "#000000";
    const mailInput = {
      kind: row.kind as EmailKind,
      to: parseRecipients(row.recipients),
      subject: row.subject,
      contentHtml: row.contentHtml,
      signatureName: row.signatureName,
      signatureColor,
    };
    const attachments = row.attachments
      ? parseAttachments(row.attachments)
      : undefined;
    sendStarted = true;
    await mailService.send({
      ...mailInput,
      signatureColor,
      ...(attachments ? { attachments } : {}),
    });
    try {
      await prisma.$transaction(async (tx) => {
        await recordMailSent(tx, row, new Date(), {
          status: { in: ["SENDING", "UNKNOWN"] },
          lockedAt,
          attempts: row.attempts,
        });
      });
    } catch {
      // The transaction may itself have committed before its response was lost.
      // Neither case permits another provider send.
      const unknown = new MailDeliveryError(
        "MAIL_SENT_COMMIT_UNCERTAIN",
        false,
        undefined,
        "UNKNOWN",
      );
      try {
        const stored = await prisma.emailOutbox.findUnique({
          where: { id },
          select: { status: true },
        });
        if (stored?.status === "SENT") return "sent";
      } catch {
        throw unknown;
      }
      throw unknown;
    }
    return "sent";
  } catch (error) {
    const deliveryError =
      error instanceof MailDeliveryError
        ? error
        : new MailDeliveryError(
            sendStarted ? "MAIL_SEND_UNCERTAIN" : "MAIL_PREPARATION_FAILED",
            !sendStarted,
            undefined,
            sendStarted ? "UNKNOWN" : "NOT_SENT",
          );
    try {
      const row = await prisma.emailOutbox.findUnique({
        where: { id },
        select: { attempts: true },
      });
      await prisma.emailOutbox.updateMany({
        where: { id, lockedAt, status: { in: ["SENDING", "UNKNOWN"] } },
        data: {
          status:
            deliveryError.outcome === "UNKNOWN"
              ? "UNKNOWN"
              : deliveryError.retryable
                ? "FAILED"
                : "REJECTED",
          ...(deliveryError.outcome === "UNKNOWN" ? {} : { lockedAt: null }),
          lastErrorCode: deliveryError.code,
          nextAttemptAt: nextRetryAt(row?.attempts ?? 1),
        },
      });
    } catch {
      // The claim remains non-retryable SENDING until stale-claim recovery.
      throw new MailDeliveryError(
        "MAIL_OUTBOX_STATE_UNAVAILABLE",
        false,
        undefined,
        "UNKNOWN",
      );
    }
    throw deliveryError;
  }
}

/** Called by the authenticated internal daily maintenance task; never expose as a public route. */
export interface MailMaintenanceResult {
  sent: number;
  failed: number;
  unknown: number;
}

export async function deliverDueOutboxMail(
  mailService: MailService,
  limit = 25,
): Promise<MailMaintenanceResult> {
  await recoverStaleMailClaims();
  const due = await prisma.emailOutbox.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      nextAttemptAt: { lte: new Date() },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  let failed = 0;
  for (const { id } of due) {
    try {
      if ((await deliverOutboxMail(id, mailService)) === "sent") sent += 1;
    } catch (error) {
      if (!(error instanceof MailDeliveryError)) throw error;
      failed += 1;
    }
  }
  const unknown = await prisma.emailOutbox.count({
    where: { status: "UNKNOWN" },
  });
  return { sent, failed, unknown };
}

function parseRecipients(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
    throw new MailDeliveryError("INVALID_OUTBOX_RECIPIENTS", false);
  return value as unknown as string[];
}

function parseAttachments(
  value: Exclude<Prisma.JsonValue, null>,
): MailAttachment[] {
  if (!Array.isArray(value))
    throw new MailDeliveryError("INVALID_OUTBOX_ATTACHMENTS", false);
  return value as unknown as MailAttachment[];
}

function nextRetryAt(attempt: number): Date {
  const delayMs = Math.min(
    60_000 * 2 ** Math.min(attempt - 1, 8),
    24 * 60 * 60 * 1000,
  );
  return new Date(Date.now() + delayMs);
}

type SentMail = {
  id: string;
  orderId: string | null;
  kind: string;
  actorName: string | null;
  reminderEventId: string | null;
  optionOrderId: string | null;
};

export async function recordMailSent(
  tx: Prisma.TransactionClient,
  row: SentMail,
  sentAt: Date,
  guard: Prisma.EmailOutboxWhereInput,
  lastErrorCode: string | null = null,
): Promise<void> {
  const updated = await tx.emailOutbox.updateMany({
    where: { id: row.id, ...guard },
    data: {
      status: "SENT",
      sentAt,
      lockedAt: null,
      lastErrorCode,
      attachments: Prisma.DbNull,
    },
  });
  if (updated.count !== 1)
    throw new MailDeliveryError(
      "MAIL_CLAIM_CHANGED",
      false,
      undefined,
      "UNKNOWN",
    );
  await tx.emailEvent.create({
    data: {
      id: randomUUID(),
      outboxId: row.id,
      orderId: row.orderId,
      kind: row.kind,
      actorName: row.actorName,
      sentAt,
    },
  });
  if (
    row.orderId &&
    (row.kind === "OFFER" || row.kind === "INQUIRY_DECLINED")
  ) {
    await tx.order.updateMany({
      where: { id: row.orderId },
      data: { edited: true },
    });
  }
  if (row.reminderEventId)
    await tx.reminderEvent.updateMany({
      where: { id: row.reminderEventId },
      data: { sentAt },
    });
  if (row.optionOrderId) {
    await tx.orderActivityEvent.create({
      data: {
        id: randomUUID(),
        orderId: row.optionOrderId,
        action: "OFFER_SENT_AS_OPTION",
        actorName: row.actorName ?? "-",
        createdAt: sentAt,
      },
    });
  }
}
