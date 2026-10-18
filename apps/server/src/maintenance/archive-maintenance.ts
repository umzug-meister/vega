import { prisma } from "../prisma.js";

interface PurgeWhere {
  archivedAt: { not: null };
  purgeAt: { lte: Date };
}

interface PurgeOperations {
  deleteOrders(where: PurgeWhere): Promise<{ count: number }>;
  deleteInvoices(where: PurgeWhere): Promise<{ count: number }>;
  deleteCreditNotes(where: PurgeWhere): Promise<{ count: number }>;
  deleteReminderEvents(where: PurgeWhere): Promise<{ count: number }>;
}

export interface ArchiveMaintenanceResult {
  orders: number;
  invoices: number;
  creditNotes: number;
  reminderEvents: number;
}

const prismaPurgeOperations: PurgeOperations = {
  deleteOrders: (where) => prisma.order.deleteMany({ where }),
  deleteInvoices: (where) => prisma.invoice.deleteMany({ where }),
  deleteCreditNotes: (where) => prisma.creditNote.deleteMany({ where }),
  deleteReminderEvents: (where) => prisma.reminderEvent.deleteMany({ where }),
};

/** Purges only currently archived records whose stored retention deadline has elapsed. */
export async function runArchiveMaintenance(
  now = new Date(),
  operations: PurgeOperations = prismaPurgeOperations,
): Promise<ArchiveMaintenanceResult> {
  const where: PurgeWhere = { archivedAt: { not: null }, purgeAt: { lte: now } };

  // Child finance records first; invoice relations use SET NULL and order relations
  // are intentionally preserved as snapshots when an order is purged.
  const reminderEvents = await operations.deleteReminderEvents(where);
  const creditNotes = await operations.deleteCreditNotes(where);
  const invoices = await operations.deleteInvoices(where);
  const orders = await operations.deleteOrders(where);

  return {
    orders: orders.count,
    invoices: invoices.count,
    creditNotes: creditNotes.count,
    reminderEvents: reminderEvents.count,
  };
}