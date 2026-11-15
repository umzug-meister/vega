import { access, readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { Storage } from "@google-cloud/storage";
import type { SetupCheckDto, SetupInfoDto, SetupSmokeTestDto, SetupVariableDto } from "@vega/domain";
import type { AppConfig } from "../config.js";
import { GeminiError, VertexGeminiClient, type GeminiClient } from "../inbox/gemini-client.js";
import { prisma } from "../prisma.js";
import { PROVIDER_TIMEOUT_MS, providerFetch } from "../maps/provider-request.js";
import { UploadError, verifyBucketPolicy } from "../uploads/upload-service.js";

export function setupInfo(config: AppConfig, env: NodeJS.ProcessEnv = process.env): SetupInfoDto {
  const variables: SetupVariableDto[] = [];
  function variable(name: string, group: string, requirement: SetupVariableDto["requirement"], hint: string, hasDefault = false) {
    variables.push({ name, group, requirement, hint, status: env[name]?.trim() ? "set" : hasDefault ? "default" : "missing" });
  }
  variable("DATABASE_URL", "Grundbetrieb", "required", "Verbindung zur MySQL-/MariaDB-Datenbank.");
  variable("APP_BASE_URL", "Grundbetrieb", "required", "Öffentliche Vega-URL; Grundlage des Einbettungscodes.", config.nodeEnv !== "production");
  variable("BETTER_AUTH_SECRET", "Grundbetrieb", "required", "Mindestens 32 Zeichen; niemals im Browser anzeigen.");
  variable("BETTER_AUTH_URL", "Grundbetrieb", "optional", "Ohne Angabe wird APP_BASE_URL verwendet.", true);
  variable("BETTER_AUTH_TRUSTED_ORIGINS", "Grundbetrieb", "required", "Exakte Admin-Origins; außerhalb Produktion standardmäßig der Auth-Origin.", config.nodeEnv !== "production");
  variable("CORS_ALLOWED_ORIGINS", "Kundenformular", "required", "Exakte WordPress-Origins, durch Kommas getrennt. Einbindung und CSP zusätzlich in WordPress prüfen.");
  variable("HOSTINGER_MAIL_API_TOKEN", "E-Mail", "required", "Für Mailversand und Passwort-Reset erforderlich.");
  variable("HOSTINGER_MAILBOX_RESOURCE_ID", "E-Mail", "required", "Gemeinsam mit dem Mail-Token setzen.");
  variable("HOSTINGER_MAIL_API_BASE_URL", "E-Mail", "optional", "Standard ist die Hostinger Mail API.", true);
  variable("GOOGLE_MAPS_API_KEY", "Google", "optional", "Für Adresssuche und Fahrstrecken; Places API (New) und Routes API freischalten.");
  variable("GEMINI_ENABLED", "Postfach-Analyse", "optional", "Aktiviert die Vertex-AI-Analyse; standardmäßig deaktiviert und erfordert GOOGLE_CLOUD_PROJECT.");
  variable("GEMINI_LOCATION", "Postfach-Analyse", "optional", "Vertex-AI-Region; Standard: global (keine EU-Datenresidenz).", true);
  variable("GEMINI_MODEL", "Postfach-Analyse", "optional", "Vertex-AI-Modell; Standard: gemini-3.1-flash-lite.", true);
  variable("GCS_BUCKET", "Bilder", "optional", "Für Bilduploads erforderlich; privater EU-Bucket mit 180-Tage-Löschregel.");
  variable("GOOGLE_CLOUD_PROJECT", "Google Cloud", "optional", "Projekt für Bilder und Vertex-AI-Analyse; alternativ aus Google Application Default Credentials ermittelt.");
  variable("GOOGLE_APPLICATION_CREDENTIALS", "Google Cloud", "optional", "Pfad zur serverseitigen Service-Account-Datei für Bilder und Vertex AI; alternativ Application Default Credentials.");
  variable("NODE_ENV", "Server", "optional", "Beim Deployment production setzen.", true);
  variable("HOST", "Server", "optional", "Standard: 0.0.0.0.", true);
  variable("PORT", "Server", "optional", "Standard: 3000; beim Hosting ggf. vom Anbieter vorgegeben.", true);
  variable("MAIL_MAINTENANCE_LIMIT", "Wartung", "optional", "Batchgröße der Mail-Wartungs-CLI; Standard: 25.", true);
  variable("INITIAL_ADMIN_EMAIL", "Einmalige Einrichtung", "bootstrap", "Nur für den Erstadmin-Seed; danach entfernen.");
  variable("INITIAL_ADMIN_PASSWORD", "Einmalige Einrichtung", "bootstrap", "Nur für den Erstadmin-Seed; danach entfernen.");
  const loaderUrl = new URL("/customer-form/loader.js", config.appBaseUrl).href;
  return {
    loaderUrl,
    embedCode: `<script src="${loaderUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")}" defer></script>`,
    variables,
  };
}

async function checkCustomerFormBuild(directory: string) {
  const manifest: unknown = JSON.parse(await readFile(resolve(directory, ".vite/manifest.json"), "utf8"));
  if (typeof manifest !== "object" || manifest === null || !Object.values(manifest).some((entry) => entry?.isEntry === true)) {
    throw new Error("INVALID_FORM_MANIFEST");
  }
  const files: string[] = [];
  for (const entry of Object.values(manifest)) {
    if (typeof entry !== "object" || entry === null || typeof entry.file !== "string"
      || (entry.css !== undefined && (!Array.isArray(entry.css) || entry.css.some((file: unknown) => typeof file !== "string")))) {
      throw new Error("INVALID_FORM_MANIFEST");
    }
    files.push(entry.file, ...(entry.css ?? []));
  }
  await Promise.all(files.map(async (file) => {
    const path = resolve(directory, file);
    if (!path.startsWith(`${resolve(directory)}${sep}`)) throw new Error("INVALID_FORM_ASSET");
    await access(path);
    if (!(await stat(path)).isFile()) throw new Error("INVALID_FORM_ASSET");
  }));
}

class ProbeError extends Error {
  constructor(message: string) { super(message); }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function providerJson(url: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
  const response = await providerFetch(url, { ...init, redirect: "error" }, signal);
  const body: unknown = await response.json();
  if (!response.ok) {
    // Only known machine codes are projected, never provider messages or payloads.
    const code = record(body) ? body.code : undefined;
    if (code === "ERR_UNAUTHORIZED") throw new ProbeError("Mail-Token fehlt oder ist ungültig.");
    if (code === "ERR_FORBIDDEN") throw new ProbeError("Der Mail-Token ist für diese Mailbox nicht berechtigt.");
    throw new ProbeError(`Provider hat die Anfrage abgewiesen (HTTP ${response.status}). Zugang, API-Freigaben und Quoten prüfen.`);
  }
  return body;
}

export async function runSetupSmokeTest(
  config: AppConfig,
  buildDirectory: string,
  signal: AbortSignal,
  geminiClient: GeminiClient | null = config.gemini ? new VertexGeminiClient(config.gemini) : null,
): Promise<SetupSmokeTestDto> {
  async function check(id: string, label: string, enabled: boolean, run: () => Promise<void>, success: string): Promise<SetupCheckDto> {
    if (!enabled) return { id, label, status: "skipped", message: "Nicht konfiguriert. Benötigte Variablen siehe unten." };
    let onAbort: () => void = () => {};
    try {
      signal.throwIfAborted();
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new Error("SETUP_CHECK_ABORTED"));
        signal.addEventListener("abort", onAbort, { once: true });
      });
      await Promise.race([run(), aborted]);
      return { id, label, status: "ok", message: success };
    } catch (error) {
      return {
        id, label, status: "error",
        message: error instanceof ProbeError ? error.message : "Prüfung fehlgeschlagen oder Zeitlimit erreicht. Konfiguration, Zugang und Erreichbarkeit prüfen.",
      };
    } finally { signal.removeEventListener("abort", onAbort); }
  }
  const checks = await Promise.all([
    check("database", "Datenbank", true, async () => {
      const result = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`;
      if (result[0]?.ok !== 1) throw new Error("INVALID_DATABASE_RESPONSE");
    }, "Datenbankverbindung und SELECT erfolgreich; keine Daten verändert."),
    check("customer-form", "Kundenformular-Build", true, () => checkCustomerFormBuild(buildDirectory),
      "Manifest und referenzierte JS-/CSS-Dateien vorhanden. WordPress/CORS/CSP separat im Browser prüfen."),
    check("mail", "Hostinger Mail", Boolean(config.mail), async () => {
      const mail = config.mail;
      if (!mail) throw new Error("MAIL_NOT_CONFIGURED");
      const result = await providerJson(new URL(`/api/v1/mailboxes/${encodeURIComponent(mail.mailboxResourceId)}/quota`, mail.apiBaseUrl).href,
        { headers: { Authorization: `Bearer ${mail.apiToken}` } }, signal);
      const quota = record(result) ? result.data : undefined;
      if (!record(quota) || !Array.isArray(quota.quotas) || typeof quota.supported !== "boolean"
        || !["totalUsage", "totalLimit", "totalPercentage"].every((key) => typeof quota[key] === "number" && Number.isFinite(quota[key]))) {
        throw new Error("INVALID_MAIL_RESPONSE");
      }
    }, "Mailbox-Quota authentifiziert gelesen. Kein Mailversand; Sendeberechtigung und Zustellung nicht geprüft."),
    check("places", "Google Places", Boolean(config.googleMapsKey), async () => {
      if (!config.googleMapsKey) throw new Error("GOOGLE_NOT_CONFIGURED");
      const result = await providerJson("https://places.googleapis.com/v1/places:autocomplete", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": config.googleMapsKey, "X-Goog-FieldMask": "suggestions.placePrediction.placeId" },
        body: JSON.stringify({ input: "Marienplatz München", includedRegionCodes: ["de", "at"], languageCode: "de" }),
      }, signal);
      if (!record(result) || !Array.isArray(result.suggestions) || result.suggestions.length === 0) throw new Error("INVALID_PLACES_RESPONSE");
    }, "Places API (New) mit synthetischer Adresse erreichbar."),
    check("routes", "Google Routes", Boolean(config.googleMapsKey), async () => {
      if (!config.googleMapsKey) throw new Error("GOOGLE_NOT_CONFIGURED");
      const result = await providerJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": config.googleMapsKey, "X-Goog-FieldMask": "routes.distanceMeters" },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: 48.137154, longitude: 11.576124 } } },
          destination: { location: { latLng: { latitude: 48.140232, longitude: 11.558335 } } },
          travelMode: "DRIVE",
        }),
      }, signal);
      if (!record(result) || !Array.isArray(result.routes) || !record(result.routes[0]) || typeof result.routes[0].distanceMeters !== "number") {
        throw new Error("INVALID_ROUTES_RESPONSE");
      }
    }, "Routes API mit synthetischer Teststrecke erreichbar."),
    check("gemini", "Vertex AI (Gemini)", Boolean(config.gemini), async () => {
      if (!config.gemini || !geminiClient) throw new Error("GEMINI_NOT_CONFIGURED");
      let result: unknown;
      try {
        result = await geminiClient.generateJson({
          systemInstruction: "Return only the requested JSON object.",
          parts: [{ text: 'Return {"ok":true}.' }],
          responseSchema: {
            type: "OBJECT",
            properties: { ok: { type: "BOOLEAN" } },
            required: ["ok"],
          },
        }, signal);
      } catch (error) {
        if (error instanceof GeminiError) {
          if (error.code === "GEMINI_AUTH_FAILED") {
            throw new ProbeError("Google-Authentifizierung für Vertex AI fehlgeschlagen. Service-Account oder ADC prüfen.");
          }
          if (error.code === "GEMINI_REQUEST_REJECTED") {
            throw new ProbeError("Vertex AI hat die Anfrage abgelehnt. Projekt, API, Modell/Region und IAM-Rolle prüfen.");
          }
          if (error.code === "GEMINI_TIMEOUT") {
            throw new ProbeError("Gemini hat nicht rechtzeitig geantwortet.");
          }
        }
        throw error;
      }
      if (!record(result) || result.ok !== true) throw new Error("INVALID_GEMINI_RESPONSE");
    }, "Vertex AI hat den synthetischen Testprompt beantwortet. Keine Maildaten gesendet."),
    check("gcs", "Google Cloud Storage", Boolean(config.gcs), async () => {
      const gcs = config.gcs;
      if (!gcs) throw new Error("GCS_NOT_CONFIGURED");
      const storage = new Storage({ ...(gcs.projectId ? { projectId: gcs.projectId } : {}), retryOptions: { autoRetry: false }, timeout: PROVIDER_TIMEOUT_MS });
      const [metadata] = await storage.bucket(gcs.bucket).getMetadata();
      try { verifyBucketPolicy(metadata); } catch (error) {
        if (!(error instanceof UploadError)) throw error;
        throw new ProbeError("Bucket erreichbar, aber private EU-Konfiguration mit genau 180 Tagen Löschfrist fehlt.");
      }
    }, "Bucket-Metadaten und private EU-/180-Tage-Regeln geprüft. Keine Dateien geschrieben; Upload/Signierung nicht geprüft."),
  ]);
  return { checkedAt: new Date().toISOString(), checks };
}
