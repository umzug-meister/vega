import { randomUUID } from "node:crypto";
import {
  manualInvoiceNextValue,
  MAX_INVOICE_SEQUENCE_VALUE,
  type InvoiceInput,
} from "@vega/domain";
import { prisma } from "../prisma.js";
import { runTransaction } from "../transaction.js";
import { invoiceData } from "./invoice-input.js";

const RETENTION_DAYS = 30;

export class InvoiceOrderError extends Error {
  constructor(readonly code: "ORDER_ARCHIVED" | "ORDER_NOT_FOUND") {
    super(code);
  }
}

export class InvoiceUpdateConflict extends Error {}

export async function createInvoice(
  input: InvoiceInput,
  order?: { id: string; orderNumber: number },
) {
  return runTransaction(async (tx) => {
    if (order) {
      const rows = await tx.$queryRaw<
        Array<{ archivedAt: Date | null }>
      >`SELECT archivedAt FROM \`order\` WHERE id = ${order.id} AND orderNumber = ${order.orderNumber} FOR UPDATE`;
      if (!rows[0]) throw new InvoiceOrderError("ORDER_NOT_FOUND");
      if (rows[0].archivedAt) throw new InvoiceOrderError("ORDER_ARCHIVED");
    }
    let invoiceNumber = input.invoiceNumber;
    if (invoiceNumber) {
      const nextValue = manualInvoiceNextValue(invoiceNumber);
      if (nextValue !== undefined) {
        if (
          !Number.isSafeInteger(nextValue) ||
          nextValue > MAX_INVOICE_SEQUENCE_VALUE
        ) {
          throw new RangeError(
            "Rechnungsnummer überschreitet den unterstützten Nummernkreis.",
          );
        }
        await tx.invoiceNumberSequence.updateMany({
          where: { id: 1, nextValue: { lt: nextValue } },
          data: { nextValue },
        });
      }
    } else {
      const sequence = await tx.invoiceNumberSequence.update({
        where: { id: 1 },
        data: { nextValue: { increment: 1 } },
        select: { nextValue: true },
      });
      invoiceNumber = `R-${sequence.nextValue - 1}`;
    }
    return tx.invoice.create({
      data: {
        id: randomUUID(),
        ...(order
          ? { orderId: order.id, orderNumberSnapshot: order.orderNumber }
          : {}),
        ...invoiceData(input, invoiceNumber),
      },
    });
  });
}

export function updateInvoice(
  id: string,
  input: InvoiceInput,
  invoiceNumber: string,
  revision: number,
) {
  return runTransaction(async (tx) => {
    const result = await tx.invoice.updateMany({
      where: { id, revision, archivedAt: null },
      data: {
        ...invoiceData(input, input.invoiceNumber ?? invoiceNumber),
        revision: { increment: 1 },
      },
    });
    if (result.count !== 1)
      throw new InvoiceUpdateConflict(
        "Die Rechnung wurde zwischenzeitlich geändert.",
      );
    return tx.invoice.findUniqueOrThrow({ where: { id } });
  });
}

export function archiveInvoice(id: string, archivedAt: Date) {
  return runTransaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });
    const purgeAt = new Date(archivedAt.getTime() + RETENTION_DAYS * 86400000);
    // Reminders have no own archive action; they follow their invoice.
    await tx.reminderEvent.updateMany({
      where: { invoiceId: id, archivedAt: null },
      data: { archivedAt, purgeAt },
    });
    return tx.invoice.update({
      where: { id, updatedAt: existing.updatedAt },
      data: {
        archivedAt,
        purgeAt,
        updatedAt: existing.updatedAt,
        revision: { increment: 1 },
      },
    });
  });
}

export function restoreInvoice(id: string) {
  return runTransaction(async (tx) => {
    const existing = await tx.invoice.findUniqueOrThrow({
      where: { id },
      select: { updatedAt: true },
    });
    await tx.reminderEvent.updateMany({
      where: { invoiceId: id, archivedAt: { not: null } },
      data: { archivedAt: null, purgeAt: null },
    });
    return tx.invoice.update({
      where: { id, updatedAt: existing.updatedAt },
      data: {
        archivedAt: null,
        purgeAt: null,
        updatedAt: existing.updatedAt,
        revision: { increment: 1 },
      },
    });
  });
}

export function recordInvoicePdfExport(orderId: string, actorName: string) {
  return prisma.orderActivityEvent.create({
    data: { id: randomUUID(), orderId, action: "PDF_EXPORTED", actorName },
  });
}
