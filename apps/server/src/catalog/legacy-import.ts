import type {
  CatalogCategoryInput,
  CatalogFurnitureInput,
  CatalogOfferInput,
  CatalogPackingInput,
  CatalogServiceInput,
} from "@vega/domain";
import {
  validateCategoryInput,
  validateFurnitureInput,
  validateOfferInput,
  validatePackingInput,
  validateServiceInput,
} from "./catalog-input.js";

/** Raw payloads of the legacy configurator REST endpoints, untrusted. */
export interface LegacyCatalogPayload {
  boxCbm: unknown;
  kleiderboxCbm: unknown;
  categories: unknown;
  items: unknown;
  services: unknown;
}

export interface LegacyImportEntry<T> {
  legacyId: number | null;
  input: T;
}

export interface LegacyFurnitureEntry extends LegacyImportEntry<CatalogFurnitureInput> {
  /** Category names resolved to ids by the importer; the legacy ids are not kept. */
  categoryNames: string[];
}

export interface LegacyCatalogImportPlan {
  boxCbm: number | null;
  kleiderboxCbm: number | null;
  categories: LegacyImportEntry<CatalogCategoryInput>[];
  furniture: LegacyFurnitureEntry[];
  services: LegacyImportEntry<CatalogServiceInput>[];
  packings: LegacyImportEntry<CatalogPackingInput>[];
  offers: LegacyImportEntry<CatalogOfferInput>[];
  skipped: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function legacyId(record: Record<string, unknown>): number | null {
  return typeof record.id === "number" && Number.isSafeInteger(record.id) && record.id > 0 ? record.id : null;
}

/** Legacy stores numbers as plain strings with dot decimals; commas are ambiguous and rejected. */
function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function integerValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
}

function showValue(value: unknown): boolean {
  return value === true || value === "on";
}

/** Box volumes are bounded like the settings form: greater than zero, at most four decimals. */
function volumeOption(value: unknown): number | null {
  const parsed = numberValue(value);
  if (parsed === null || parsed <= 0 || parsed > 10) return null;
  return Math.abs(parsed * 10_000 - Math.round(parsed * 10_000)) <= 1e-6 ? parsed : null;
}

function issuesText(issues: ReadonlyArray<{ field: string; message: string }>): string {
  return issues.map((issue) => `${issue.field}: ${issue.message}`).join(" · ");
}

function planCategories(raw: unknown, plan: LegacyCatalogImportPlan): void {
  if (!Array.isArray(raw)) {
    plan.skipped.push("Kategorien: Antwort ist keine Liste.");
    return;
  }
  for (const entry of raw) {
    if (!isRecord(entry)) {
      plan.skipped.push("Kategoriedatensatz ohne Struktur übersprungen.");
      continue;
    }
    // The legacy slug is not part of the target structure and is dropped.
    const result = validateCategoryInput({ name: entry.name, sort: plan.categories.length * 10 });
    if (!result.ok) {
      plan.skipped.push(`Kategorie ${String(entry.name)} übersprungen (${issuesText(result.issues)}).`);
      continue;
    }
    plan.categories.push({ legacyId: legacyId(entry), input: result.value });
  }
}

function planFurniture(raw: unknown, plan: LegacyCatalogImportPlan): void {
  if (!Array.isArray(raw)) {
    plan.skipped.push("Möbel: Antwort ist keine Liste.");
    return;
  }
  for (const entry of raw) {
    if (!isRecord(entry)) {
      plan.skipped.push("Möbel-Datensatz ohne Struktur übersprungen.");
      continue;
    }
    const id = legacyId(entry);
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    if (!name) {
      plan.skipped.push(`Möbel #${id ?? "?"} ohne Namen übersprungen.`);
      continue;
    }
    const volume = numberValue(entry.volume);
    if (volume === null || volume < 0) {
      plan.skipped.push(`Möbel "${name}" ohne gültiges Volumen übersprungen.`);
      continue;
    }
    const rawStep = numberValue(entry.step);
    const step = rawStep === 0.5 || rawStep === 1 ? rawStep : 1;
    if (rawStep !== null && rawStep !== step) {
      plan.skipped.push(`Möbel "${name}" hatte die ungültige Schrittgröße ${rawStep}; übernommen mit Schritt 1.`);
    }
    const sortOrder = integerValue(entry.sortOrder) ?? 0;
    const categoryNames = Array.isArray(entry.categoryRefs)
      ? [...new Set(entry.categoryRefs.filter(isRecord).map((ref) => (typeof ref.name === "string" ? ref.name.trim() : "")).filter(Boolean))]
      : [];
    if (!categoryNames.length) {
      plan.skipped.push(`Möbel "${name}" ohne Kategorie übersprungen.`);
      continue;
    }
    const result = validateFurnitureInput({ name, categoryIds: [], volume, step, sortOrder });
    if (!result.ok) {
      plan.skipped.push(`Möbel "${name}" übersprungen (${issuesText(result.issues)}).`);
      continue;
    }
    plan.furniture.push({ legacyId: id, input: result.value, categoryNames });
  }
}

function offerName(workers: number, trucks: number): string {
  return `${workers} Träger · ${trucks} LKW`;
}

function planOffer(entry: Record<string, unknown>, id: number | null, plan: LegacyCatalogImportPlan): boolean {
  const workers = integerValue(entry.workers);
  const trucks = integerValue(entry.t35);
  const includedHours = integerValue(entry.includedHours);
  if (workers === null || trucks === null || includedHours === null) {
    plan.skipped.push(`Angebot #${id ?? "?"} ohne Träger-, LKW- oder Stundenangabe übersprungen.`);
    return false;
  }
  const result = validateOfferInput({
    name: offerName(workers, trucks),
    workers,
    trucks,
    includedHours,
    sum: numberValue(entry.sum),
    hourPrice: numberValue(entry.hourPrice),
    ridingCosts: numberValue(entry.ridingCosts),
    sort: 0,
  });
  if (!result.ok) {
    plan.skipped.push(`Angebot ${offerName(workers, trucks)} (${includedHours} Std.) übersprungen (${issuesText(result.issues)}).`);
    return false;
  }
  plan.offers.push({ legacyId: id, input: result.value });
  return true;
}

function planService(entry: Record<string, unknown>, id: number | null, plan: LegacyCatalogImportPlan): boolean {
  const result = validateServiceInput({
    name: entry.name,
    price: numberValue(entry.price),
    sort: integerValue(entry.sort) ?? 0,
    show: showValue(entry.show),
  });
  if (!result.ok) {
    plan.skipped.push(`Service #${id ?? "?"} (${String(entry.name)}) übersprungen (${issuesText(result.issues)}).`);
    return false;
  }
  plan.services.push({ legacyId: id, input: result.value });
  return true;
}

function planPacking(entry: Record<string, unknown>, id: number | null, plan: LegacyCatalogImportPlan): boolean {
  const description = typeof entry.description === "string" ? entry.description : typeof entry.desc === "string" ? entry.desc : "";
  const media = typeof entry.imgUrl === "string" ? entry.imgUrl.trim() : "";
  const result = validatePackingInput({
    name: entry.name,
    price: numberValue(entry.price),
    description,
    media: media || null,
    sort: integerValue(entry.sort) ?? 0,
    show: showValue(entry.show),
  });
  if (!result.ok) {
    plan.skipped.push(`Packmaterial #${id ?? "?"} (${String(entry.name)}) übersprungen (${issuesText(result.issues)}).`);
    return false;
  }
  plan.packings.push({ legacyId: id, input: result.value });
  return true;
}

function planServices(raw: unknown, plan: LegacyCatalogImportPlan): void {
  if (!Array.isArray(raw)) {
    plan.skipped.push("Services: Antwort ist keine Liste.");
    return;
  }
  let ignoredCounters = 0;
  for (const entry of raw) {
    if (!isRecord(entry)) {
      plan.skipped.push("Service-Datensatz ohne Struktur übersprungen.");
      continue;
    }
    const id = legacyId(entry);
    const tag = typeof entry.tag === "string" ? entry.tag : "";
    if (tag === "Price") {
      planOffer(entry, id, plan);
    } else if (tag === "Bohrarbeiten") {
      planService(entry, id, plan);
    } else if (tag === "Packmaterial") {
      planPacking(entry, id, plan);
    } else {
      // Legacy lead/offer counters are statistics, not catalog content.
      ignoredCounters += 1;
    }
  }
  if (ignoredCounters) plan.skipped.push(`${ignoredCounters} Zähler-Datensätze (Counter) ignoriert; keine Katalogdaten.`);
}

export function buildLegacyCatalogImportPlan(payload: LegacyCatalogPayload): LegacyCatalogImportPlan {
  const plan: LegacyCatalogImportPlan = {
    boxCbm: volumeOption(payload.boxCbm),
    kleiderboxCbm: volumeOption(payload.kleiderboxCbm),
    categories: [],
    furniture: [],
    services: [],
    packings: [],
    offers: [],
    skipped: [],
  };
  if (plan.boxCbm === null) plan.skipped.push("Umzugskarton-Volumen fehlt oder ist ungültig.");
  if (plan.kleiderboxCbm === null) plan.skipped.push("Kleiderbox-Volumen fehlt oder ist ungültig.");
  planCategories(payload.categories, plan);
  planFurniture(payload.items, plan);
  planServices(payload.services, plan);
  return plan;
}
