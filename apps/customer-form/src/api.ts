import type {
  CatalogCategoryDto,
  CatalogFurnitureDto,
  CatalogPackingDto,
  CatalogServiceDto,
  CatalogServiceRateDto,
  CustomerFormConfig,
} from "@vega/domain";
import type { FormResources } from "./form-model.js";

let apiBase = "";
export function setApiBase(base: string) {
  apiBase = base;
}
export async function request<T>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    credentials: "omit",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...(signal ? { signal } : {}),
  });
  const result = (await response.json()) as {
    data?: T;
    error?: { message?: string; issues?: Array<{ message: string }> };
  };
  if (!response.ok)
    throw new Error(
      result.error?.issues?.[0]?.message ??
        result.error?.message ??
        "Die Anfrage konnte nicht verarbeitet werden.",
    );
  if (result.data === undefined)
    throw new Error("Die Serverantwort ist unvollständig.");
  return result.data;
}
export async function loadResources(
  signal: AbortSignal,
): Promise<FormResources> {
  const [config, categories, furniture, packings, services, rates] =
    await Promise.all([
      request<CustomerFormConfig>(
        "/api/customer-form/config",
        undefined,
        signal,
      ),
      request<CatalogCategoryDto[]>(
        "/api/catalog/categories",
        undefined,
        signal,
      ),
      request<CatalogFurnitureDto[]>(
        "/api/catalog/furniture",
        undefined,
        signal,
      ),
      request<CatalogPackingDto[]>("/api/catalog/packings", undefined, signal),
      request<CatalogServiceDto[]>("/api/catalog/services", undefined, signal),
      request<CatalogServiceRateDto[]>(
        "/api/catalog/service-rates",
        undefined,
        signal,
      ),
    ]);
  return { config, categories, furniture, packings, services, rates };
}
