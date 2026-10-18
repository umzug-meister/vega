import "dotenv/config";
import { prisma } from "./prisma.js";
import { loadConfig } from "./config.js";
import { createConfiguredMailService } from "./mail/configured-mail-service.js";
import { resolveMaintenanceLimit, runMailMaintenance } from "./mail/mail-maintenance.js";
import { runArchiveMaintenance } from "./maintenance/archive-maintenance.js";

async function runCron(): Promise<void> {
  let failed = false;

  try {
    const result = await runArchiveMaintenance();
    console.info(JSON.stringify({ event: "archive-maintenance", ...result }));
  } catch {
    failed = true;
    console.error(JSON.stringify({ event: "archive-maintenance-failed", code: "ARCHIVE_MAINTENANCE_FAILED" }));
  }

  try {
    const config = loadConfig();
    const mailService = createConfiguredMailService(config);
    if (!mailService) throw new Error("Mail transport is not configured.");

    const limit = resolveMaintenanceLimit(process.env.MAIL_MAINTENANCE_LIMIT);
    const result = await runMailMaintenance(mailService, limit);
    console.info(JSON.stringify({ event: "mail-maintenance", ...result, limit }));
  } catch {
    failed = true;
    console.error(JSON.stringify({ event: "mail-maintenance-failed", code: "MAIL_MAINTENANCE_FAILED" }));
  }

  process.exitCode = failed ? 1 : 0;
}

try {
  await runCron();
} finally {
  await prisma.$disconnect();
}