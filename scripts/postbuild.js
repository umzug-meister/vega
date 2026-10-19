import { spawnSync } from "node:child_process";

if (process.env.VEGA_MIGRATE_ON_BUILD !== "true") {
  console.info(
    "Skipping database migrations: VEGA_MIGRATE_ON_BUILD is not true.",
  );
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  console.error("Cannot run database migrations: DATABASE_URL is not set.");
  process.exit(1);
}

console.info("Running pending database migrations after build.");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmCommand, ["run", "db:migrate:deploy"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error || result.status === null) {
  console.error("Could not run database migrations after build.");
  process.exit(1);
}

process.exit(result.status);
