import { readFileSync } from "node:fs";

const DATABASE_OPTIONS = new Set(["connection_limit", "connect_timeout", "pool_timeout", "sslcert", "sslaccept"]);

export function loadDatabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL muss für den Server gesetzt sein.");
  }

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL muss eine gültige MySQL-URL sein.");
  }
  if (url.protocol !== "mysql:" || !url.hostname || !url.username || !/^\/[^/]+$/u.test(url.pathname) || url.hash) {
    throw new Error("DATABASE_URL muss eine MySQL-URL mit Host, Benutzer und Datenbank sein.");
  }
  const port = url.port ? Number(url.port) : 3306;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("DATABASE_URL enthält einen ungültigen Port.");
  }
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!DATABASE_OPTIONS.has(key) || seen.has(key)) {
      throw new Error("DATABASE_URL enthält nicht unterstützte oder doppelte Optionen.");
    }
    seen.add(key);
  }

  function integerOption(key: string, fallback: number, multiplier = 1) {
    const raw = url.searchParams.get(key);
    if (raw === null) return fallback;
    const value = Number(raw) * multiplier;
    if (!/^[0-9]+$/u.test(raw) || !Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`DATABASE_URL: ${key} muss eine positive ganze Zahl sein.`);
    }
    return value;
  }

  let user: string;
  let password: string;
  let database: string;
  try {
    user = decodeURIComponent(url.username);
    password = decodeURIComponent(url.password);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error("DATABASE_URL enthält eine ungültige Prozentkodierung.");
  }
  if (database.includes("/") || [user, password, database].some((value) => value.includes("\0"))) {
    throw new Error("DATABASE_URL enthält ungültige Verbindungsdaten.");
  }

  const sslaccept = url.searchParams.get("sslaccept");
  if (sslaccept !== null && sslaccept !== "strict") {
    throw new Error("DATABASE_URL: sslaccept erlaubt ausschließlich strict.");
  }
  const certificatePath = url.searchParams.get("sslcert");
  let ssl: boolean | { ca: Buffer; rejectUnauthorized: true } = sslaccept === "strict";
  if (certificatePath !== null) {
    if (!certificatePath.trim()) {
      throw new Error("DATABASE_URL: sslcert benötigt eine CA-Datei.");
    }
    let ca: Buffer;
    try {
      ca = readFileSync(certificatePath);
    } catch {
      throw new Error("DATABASE_URL: sslcert konnte nicht gelesen werden.");
    }
    ssl = { ca, rejectUnauthorized: true };
  }

  return {
    host: url.hostname.replace(/^\[|\]$/gu, ""),
    port,
    user,
    password,
    database,
    connectionLimit: integerOption("connection_limit", 5),
    connectTimeout: integerOption("connect_timeout", 5_000, 1_000),
    acquireTimeout: integerOption("pool_timeout", 10_000, 1_000),
    idleTimeout: 300,
    minimumIdle: 0,
    timezone: "+00:00",
    logParam: false,
    // Pin the session collation to the one used by every migration. MariaDB
    // 11.5+ defaults utf8mb4 to uca1400, and some hosts ignore the client
    // handshake charset; `contains`/LIKE then fails with ER 1267 when the
    // connection collation differs from the table collation.
    charset: "utf8mb4",
    collation: "UTF8MB4_UNICODE_CI",
    initSql: "SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci",
    ssl,
  };
}
