import assert from "node:assert/strict";
import test from "node:test";
import { runArchiveMaintenance } from "../src/maintenance/archive-maintenance.js";

test("archive maintenance deletes only due archived records in dependency-safe order", async () => {
  const now = new Date("2026-10-18T02:00:00.000Z");
  const calls: string[] = [];
  const operations = {
    deleteReminderEvents: async (where: unknown) => { calls.push("reminders"); assert.deepEqual(where, { archivedAt: { not: null }, purgeAt: { lte: now } }); return { count: 1 }; },
    deleteCreditNotes: async () => { calls.push("credit-notes"); return { count: 2 }; },
    deleteInvoices: async () => { calls.push("invoices"); return { count: 3 }; },
    deleteOrders: async () => { calls.push("orders"); return { count: 4 }; },
  };

  const result = await runArchiveMaintenance(now, operations);

  assert.deepEqual(calls, ["reminders", "credit-notes", "invoices", "orders"]);
  assert.deepEqual(result, { orders: 4, invoices: 3, creditNotes: 2, reminderEvents: 1 });
});