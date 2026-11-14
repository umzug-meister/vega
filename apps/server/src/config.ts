export interface AppConfig {
  appBaseUrl: URL;
  betterAuthSecret: string;
  betterAuthUrl: URL;
  betterAuthTrustedOrigins: string[];
  corsAllowedOrigins: string[];
  host: string;
  nodeEnv: string;
  port: number;
  mail: HostingerMailConfig | null;
  gcs?: { bucket: string; projectId?: string };
  googleMapsKey?: string;
  gemini?: GeminiConfig;
}

export interface GeminiConfig {
  projectId: string;
  location: string;
  model: string;
}

export interface HostingerMailConfig {
  apiToken: string;
  mailboxResourceId: string;
  apiBaseUrl: URL;
}

function parseOriginList(value: string | undefined): string[] {
  if (!value?.trim()) return [];

  return value.split(",").map((entry) => {
    const candidate = entry.trim();
    if (candidate === "*") {
      throw new Error(
        "CORS_ALLOWED_ORIGINS darf keinen Wildcard-Origin enthalten.",
      );
    }

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new Error(
        `Ungültiger Origin in CORS_ALLOWED_ORIGINS: ${candidate}`,
      );
    }

    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== candidate ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        `CORS-Origin muss exakt Schema, Host und optionalen Port enthalten: ${candidate}`,
      );
    }

    return parsed.origin;
  });
}

const LEGACY_GOOGLE_KEY_VARIABLES = [
  "GOOGLE_PLACES_API_KEY",
  "GOOGLE_ROUTES_API_KEY",
] as const;

/** Names only, never values: lets startup point out ignored pre-consolidation variables. */
export function legacyGoogleKeyVariables(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return LEGACY_GOOGLE_KEY_VARIABLES.filter((name) =>
    Boolean(env[name]?.trim()),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const rawBaseUrl = env.APP_BASE_URL ?? "http://localhost:3000";
  let appBaseUrl: URL;

  try {
    appBaseUrl = new URL(rawBaseUrl);
  } catch {
    throw new Error("APP_BASE_URL muss eine gültige absolute URL sein.");
  }

  if (
    !["http:", "https:"].includes(appBaseUrl.protocol) ||
    appBaseUrl.username ||
    appBaseUrl.password
  ) {
    throw new Error(
      "APP_BASE_URL muss eine HTTP(S)-URL ohne Zugangsdaten sein.",
    );
  }

  const corsAllowedOrigins = parseOriginList(env.CORS_ALLOWED_ORIGINS);
  const betterAuthSecret = env.BETTER_AUTH_SECRET;
  if (!betterAuthSecret || betterAuthSecret.length < 32) {
    throw new Error(
      "BETTER_AUTH_SECRET muss gesetzt sein und mindestens 32 Zeichen enthalten.",
    );
  }

  const rawBetterAuthUrl = env.BETTER_AUTH_URL ?? rawBaseUrl;
  let betterAuthUrl: URL;
  try {
    betterAuthUrl = new URL(rawBetterAuthUrl);
  } catch {
    throw new Error("BETTER_AUTH_URL muss eine gültige absolute URL sein.");
  }
  if (
    !["http:", "https:"].includes(betterAuthUrl.protocol) ||
    betterAuthUrl.username ||
    betterAuthUrl.password ||
    betterAuthUrl.pathname !== "/" ||
    betterAuthUrl.search ||
    betterAuthUrl.hash
  ) {
    throw new Error(
      "BETTER_AUTH_URL muss ein HTTP(S)-Origin ohne Pfad oder Zugangsdaten sein.",
    );
  }

  const betterAuthTrustedOrigins = parseOriginList(
    env.BETTER_AUTH_TRUSTED_ORIGINS,
  );
  if (betterAuthTrustedOrigins.length === 0) {
    if (nodeEnv === "production") {
      throw new Error(
        "BETTER_AUTH_TRUSTED_ORIGINS muss in Produktion explizit gesetzt sein.",
      );
    }
    betterAuthTrustedOrigins.push(betterAuthUrl.origin);
  }

  if (nodeEnv === "production") {
    if (!env.APP_BASE_URL) {
      throw new Error("APP_BASE_URL muss in Produktion explizit gesetzt sein.");
    }
    if (appBaseUrl.protocol !== "https:") {
      throw new Error("APP_BASE_URL muss in Produktion HTTPS verwenden.");
    }
    if (corsAllowedOrigins.length === 0) {
      throw new Error(
        "CORS_ALLOWED_ORIGINS muss in Produktion explizit gesetzt sein.",
      );
    }
    if (
      corsAllowedOrigins.some((origin) => new URL(origin).protocol !== "https:")
    ) {
      throw new Error("CORS-Origins müssen in Produktion HTTPS verwenden.");
    }
    if (betterAuthUrl.protocol !== "https:") {
      throw new Error("BETTER_AUTH_URL muss in Produktion HTTPS verwenden.");
    }
    if (
      betterAuthTrustedOrigins.some(
        (origin) => new URL(origin).protocol !== "https:",
      )
    ) {
      throw new Error(
        "Better-Auth-Trusted-Origins müssen in Produktion HTTPS verwenden.",
      );
    }
  }

  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  }

  const mailToken = env.HOSTINGER_MAIL_API_TOKEN?.trim();
  const mailboxResourceId = env.HOSTINGER_MAILBOX_RESOURCE_ID?.trim();
  if (Boolean(mailToken) !== Boolean(mailboxResourceId)) {
    throw new Error(
      "HOSTINGER_MAIL_API_TOKEN und HOSTINGER_MAILBOX_RESOURCE_ID müssen gemeinsam gesetzt werden.",
    );
  }
  let mail: HostingerMailConfig | null = null;
  if (mailToken && mailboxResourceId) {
    let apiBaseUrl: URL;
    try {
      apiBaseUrl = new URL(
        env.HOSTINGER_MAIL_API_BASE_URL?.trim() ||
          "https://api.mail.hostinger.com",
      );
    } catch {
      throw new Error(
        "HOSTINGER_MAIL_API_BASE_URL muss eine gültige absolute URL sein.",
      );
    }
    if (
      apiBaseUrl.protocol !== "https:" ||
      apiBaseUrl.username ||
      apiBaseUrl.password
    ) {
      throw new Error(
        "HOSTINGER_MAIL_API_BASE_URL muss eine HTTPS-URL ohne Zugangsdaten sein.",
      );
    }
    mail = { apiToken: mailToken, mailboxResourceId, apiBaseUrl };
  }
  if (nodeEnv === "production" && !mail) {
    throw new Error(
      "HOSTINGER_MAIL_API_TOKEN und HOSTINGER_MAILBOX_RESOURCE_ID müssen in Produktion gesetzt sein.",
    );
  }

  const geminiEnabled = env.GEMINI_ENABLED?.trim().toLowerCase() === "true";
  const geminiProject = env.GOOGLE_CLOUD_PROJECT?.trim();
  if (geminiEnabled && !geminiProject) {
    throw new Error("GEMINI_ENABLED erfordert GOOGLE_CLOUD_PROJECT.");
  }
  const geminiLocation = env.GEMINI_LOCATION?.trim() || "global";
  if (
    geminiLocation !== "global" &&
    !/^[a-z]+-[a-z]+[0-9]+$/u.test(geminiLocation)
  ) {
    throw new Error(
      'GEMINI_LOCATION muss "global" oder eine Vertex-AI-Region sein.',
    );
  }
  const geminiModel = env.GEMINI_MODEL?.trim() || "gemini-3.1-flash-lite";
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/u.test(geminiModel)) {
    throw new Error("GEMINI_MODEL enthält ungültige Zeichen.");
  }

  return {
    appBaseUrl,
    betterAuthSecret,
    betterAuthUrl,
    betterAuthTrustedOrigins,
    corsAllowedOrigins,
    host: env.HOST ?? "0.0.0.0",
    nodeEnv,
    port,
    mail,
    ...(env.GCS_BUCKET?.trim()
      ? {
          gcs: {
            bucket: env.GCS_BUCKET.trim(),
            ...(env.GOOGLE_CLOUD_PROJECT?.trim()
              ? { projectId: env.GOOGLE_CLOUD_PROJECT.trim() }
              : {}),
          },
        }
      : {}),
    ...(geminiEnabled && geminiProject
      ? {
          gemini: {
            projectId: geminiProject,
            location: geminiLocation,
            model: geminiModel,
          },
        }
      : {}),
    ...(env.GOOGLE_MAPS_API_KEY?.trim()
      ? { googleMapsKey: env.GOOGLE_MAPS_API_KEY.trim() }
      : {}),
  };
}
