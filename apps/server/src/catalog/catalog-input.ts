import {
  MAX_TRUCKS,
  SERVICE_RATE_KEYS,
  type CatalogCategoryInput,
  type CatalogFurnitureInput,
  type CatalogOfferInput,
  type CatalogPackingInput,
  type CatalogServiceInput,
  type CatalogServiceRateDto,
  type ServiceRateKey,
} from "@vega/domain";
import { sanitizeRichTextHtml } from "../rich-text.js";

export interface CatalogInputIssue {
  field: string;
  message: string;
}

export type CatalogValidation<T> =
  | { ok: true; value: T }
  | { ok: false; issues: CatalogInputIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRecord(value: unknown): { record: Record<string, unknown>; issues: CatalogInputIssue[] } {
  if (isRecord(value)) return { record: value, issues: [] };
  return { record: {}, issues: [{ field: "body", message: "Ungültige Anfrage." }] };
}

function parseName(record: Record<string, unknown>, issues: CatalogInputIssue[]): string {
  if (typeof record.name !== "string" || !record.name.trim()) {
    issues.push({ field: "name", message: "Bitte geben Sie einen Namen ein." });
    return "";
  }
  if (record.name.trim().length > 191) issues.push({ field: "name", message: "Der Name darf höchstens 191 Zeichen enthalten." });
  return record.name.trim();
}

function parseInteger(
  record: Record<string, unknown>,
  key: string,
  issues: CatalogInputIssue[],
  { min = 0, max = 100_000, optional = false }: { min?: number; max?: number; optional?: boolean } = {},
): number | null {
  const value = record[key];
  if (optional && value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    issues.push({ field: key, message: `Bitte geben Sie eine ganze Zahl zwischen ${min} und ${max} ein.` });
    return 0;
  }
  return value;
}

function parsePrice(record: Record<string, unknown>, key: string, issues: CatalogInputIssue[]): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10_000_000 || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) {
    issues.push({ field: key, message: "Bitte geben Sie einen nicht-negativen Betrag mit höchstens zwei Nachkommastellen ein." });
    return 0;
  }
  return value;
}

function parseBoolean(record: Record<string, unknown>, key: string, issues: CatalogInputIssue[]): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    issues.push({ field: key, message: "Ungültiger Ja/Nein-Wert." });
    return false;
  }
  return value;
}

function parseSort(record: Record<string, unknown>, issues: CatalogInputIssue[], key = "sort"): number {
  return parseInteger(record, key, issues, { max: 1_000_000 }) ?? 0;
}

export function validateCategoryInput(input: unknown): CatalogValidation<CatalogCategoryInput> {
  const { record, issues } = parseRecord(input);
  const value = { name: parseName(record, issues), sort: parseSort(record, issues) };
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

export function validateFurnitureInput(input: unknown): CatalogValidation<CatalogFurnitureInput> {
  const { record, issues } = parseRecord(input);
  const name = parseName(record, issues);
  const categoryIdsRaw = record.categoryIds;
  const categoryIds: number[] = [];
  if (!Array.isArray(categoryIdsRaw) || categoryIdsRaw.length > 200 || categoryIdsRaw.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) {
    issues.push({ field: "categoryIds", message: "Bitte wählen Sie gültige Kategorien aus." });
  } else {
    categoryIds.push(...new Set(categoryIdsRaw as number[]));
  }
  const volume = record.volume;
  if (typeof volume !== "number" || !Number.isFinite(volume) || volume < 0 || volume > 100_000 || Math.abs(volume * 100 - Math.round(volume * 100)) > 0.00001) {
    issues.push({ field: "volume", message: "Bitte geben Sie ein gültiges Volumen mit höchstens zwei Nachkommastellen ein." });
  }
  const rawStep = record.step === undefined ? 1 : record.step;
  const step = typeof rawStep === "number" && Number.isFinite(rawStep) && rawStep >= 0.5 && rawStep <= 100_000
    ? rawStep
    : 0;
  if (step === 0 || Math.abs(step * 2 - Math.round(step * 2)) > 0.00001) {
    issues.push({ field: "step", message: "Bitte geben Sie ein Vielfaches von 0,5 zwischen 0,5 und 100.000 ein." });
  }
  const value: CatalogFurnitureInput = {
    name,
    categoryIds,
    volume: typeof volume === "number" && Number.isFinite(volume) && volume >= 0 && volume <= 100_000 ? volume : 0,
    step,
    sortOrder: record.sortOrder === undefined ? 0 : parseSort(record, issues, "sortOrder"),
  };
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

export function validateServiceInput(input: unknown): CatalogValidation<CatalogServiceInput> {
  const { record, issues } = parseRecord(input);
  const value = {
    name: parseName(record, issues),
    price: parsePrice(record, "price", issues),
    sort: parseSort(record, issues),
    show: parseBoolean(record, "show", issues),
  };
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

export function validatePackingInput(input: unknown): CatalogValidation<CatalogPackingInput> {
  const { record, issues } = parseRecord(input);
  const name = parseName(record, issues);
  const description = record.description;
  if (typeof description !== "string" || description.length > 10_000) issues.push({ field: "description", message: "Die Beschreibung darf höchstens 10.000 Zeichen enthalten." });
  const mediaRaw = record.media;
  let media: string | null = null;
  if (mediaRaw !== undefined && mediaRaw !== null && mediaRaw !== "") {
    if (typeof mediaRaw !== "string" || mediaRaw.length > 2048) issues.push({ field: "media", message: "Ungültiger Medien-Link." });
    else {
      try {
        const mediaUrl = new URL(mediaRaw);
        if (mediaUrl.protocol !== "https:" && mediaUrl.protocol !== "http:") throw new Error("invalid protocol");
        media = mediaUrl.toString();
      } catch {
        issues.push({ field: "media", message: "Bitte geben Sie einen gültigen HTTP(S)-Link ein." });
      }
    }
  }
  const value = {
    name,
    price: parsePrice(record, "price", issues),
    description:
      typeof description === "string"
        ? sanitizeRichTextHtml(description.trim())
        : "",
    media,
    sort: parseSort(record, issues),
    show: parseBoolean(record, "show", issues),
  };
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

export function validateOfferInput(input: unknown): CatalogValidation<CatalogOfferInput> {
  const { record, issues } = parseRecord(input);
  const workers = parseInteger(record, "workers", issues, { min: 1, max: 100 });
  const trucks = parseInteger(record, "trucks", issues, { min: 1, max: MAX_TRUCKS });
  const includedHours = parseInteger(record, "includedHours", issues, { min: 1, max: 24 });
  const value = {
    name: parseName(record, issues),
    workers: workers ?? 1,
    trucks: trucks ?? 1,
    includedHours: includedHours ?? 1,
    sum: parsePrice(record, "sum", issues),
    hourPrice: parsePrice(record, "hourPrice", issues),
    ridingCosts: parsePrice(record, "ridingCosts", issues),
    sort: parseSort(record, issues),
  };
  return issues.length ? { ok: false, issues } : { ok: true, value };
}

export function validateServiceRateInput(key: string, input: unknown): CatalogValidation<CatalogServiceRateDto> {
  const { record, issues } = parseRecord(input);
  if (!SERVICE_RATE_KEYS.includes(key as ServiceRateKey)) issues.push({ field: "key", message: "Unbekannter Preisparameter." });
  const price = parsePrice(record, "price", issues);
  return issues.length ? { ok: false, issues } : { ok: true, value: { key: key as ServiceRateKey, price } };
}
