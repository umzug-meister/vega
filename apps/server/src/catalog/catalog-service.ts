import type {
  CatalogCategoryDto,
  CatalogCategoryInput,
  CatalogFurnitureDto,
  CatalogFurnitureInput,
  CatalogOfferDto,
  CatalogOfferInput,
  CatalogPackingDto,
  CatalogPackingInput,
  CatalogServiceDto,
  CatalogServiceInput,
  CatalogServiceRateDto,
  ServiceRateKey,
} from "@vega/domain";
import { SERVICE_RATE_KEYS } from "@vega/domain";
import { prisma } from "../prisma.js";
import { sanitizeRichTextHtml } from "../rich-text.js";

function toCategoryDto(category: { id: number; name: string; sort: number }): CatalogCategoryDto {
  return { id: category.id, name: category.name, sort: category.sort };
}

function toFurnitureDto(furniture: {
  id: number;
  name: string;
  volume: unknown;
  step: unknown;
  sortOrder: number;
  categories: Array<{ category: { id: number; name: string } }>;
}): CatalogFurnitureDto {
  const categoryRefs = furniture.categories.map(({ category }) => ({ id: category.id, name: category.name }));
  return {
    id: furniture.id,
    name: furniture.name,
    categoryIds: categoryRefs.map(({ id }) => id),
    categoryRefs,
    volume: Number(furniture.volume),
    step: Number(furniture.step),
    sortOrder: furniture.sortOrder,
  };
}

function toServiceDto(service: { id: number; name: string; price: unknown; sort: number; show: boolean }): CatalogServiceDto {
  return { id: service.id, name: service.name, price: Number(service.price), sort: service.sort, show: service.show };
}

function toPackingDto(packing: { id: number; name: string; price: unknown; description: string; media: string | null; sort: number; show: boolean }): CatalogPackingDto {
  return { id: packing.id, name: packing.name, price: Number(packing.price), description: sanitizeRichTextHtml(packing.description), media: packing.media, sort: packing.sort, show: packing.show };
}

function toOfferDto(offer: { id: number; name: string; workers: number; trucks: number; includedHours: number; sum: unknown; hourPrice: unknown; ridingCosts: unknown; sort: number }): CatalogOfferDto {
  return {
    id: offer.id,
    name: offer.name,
    workers: offer.workers,
    trucks: offer.trucks,
    includedHours: offer.includedHours,
    sum: Number(offer.sum),
    hourPrice: Number(offer.hourPrice),
    ridingCosts: Number(offer.ridingCosts),
    sort: offer.sort,
  };
}

const furnitureInclude = {
  categories: { include: { category: { select: { id: true, name: true } } } },
} as const;

export async function listCategories(): Promise<CatalogCategoryDto[]> {
  const rows = await prisma.catalogCategory.findMany({ orderBy: [{ sort: "asc" }, { id: "asc" }] });
  return rows.map(toCategoryDto);
}

export async function createCategory(input: CatalogCategoryInput): Promise<CatalogCategoryDto> {
  return toCategoryDto(await prisma.catalogCategory.create({ data: input }));
}

export async function updateCategory(id: number, input: CatalogCategoryInput): Promise<CatalogCategoryDto> {
  return toCategoryDto(await prisma.catalogCategory.update({ where: { id }, data: input }));
}

export async function deleteCategory(id: number): Promise<void> {
  await prisma.catalogCategory.delete({ where: { id } });
}

export async function listFurniture(): Promise<CatalogFurnitureDto[]> {
  const rows = await prisma.catalogFurniture.findMany({
    include: furnitureInclude,
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });
  return rows.map(toFurnitureDto);
}

async function assertCategoryIdsExist(categoryIds: number[]) {
  if (categoryIds.length === 0) return;
  const count = await prisma.catalogCategory.count({ where: { id: { in: categoryIds } } });
  if (count !== categoryIds.length) throw new Error("INVALID_CATEGORY_REFERENCE");
}

function furnitureData(input: CatalogFurnitureInput) {
  const { categoryIds: _categoryIds, ...data } = input;
  return data;
}

export async function createFurniture(input: CatalogFurnitureInput): Promise<CatalogFurnitureDto> {
  await assertCategoryIdsExist(input.categoryIds);
  return prisma.$transaction(async (transaction) => {
    const furniture = await transaction.catalogFurniture.create({ data: furnitureData(input) });
    if (input.categoryIds.length) {
      await transaction.catalogFurnitureCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ furnitureId: furniture.id, categoryId })) });
    }
    const created = await transaction.catalogFurniture.findUniqueOrThrow({ where: { id: furniture.id }, include: furnitureInclude });
    return toFurnitureDto(created);
  });
}

export async function updateFurniture(id: number, input: CatalogFurnitureInput): Promise<CatalogFurnitureDto> {
  await assertCategoryIdsExist(input.categoryIds);
  return prisma.$transaction(async (transaction) => {
    await transaction.catalogFurniture.update({ where: { id }, data: furnitureData(input) });
    await transaction.catalogFurnitureCategory.deleteMany({ where: { furnitureId: id } });
    if (input.categoryIds.length) {
      await transaction.catalogFurnitureCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ furnitureId: id, categoryId })) });
    }
    const updated = await transaction.catalogFurniture.findUniqueOrThrow({ where: { id }, include: furnitureInclude });
    return toFurnitureDto(updated);
  });
}

export async function deleteFurniture(id: number): Promise<void> {
  await prisma.catalogFurniture.delete({ where: { id } });
}

export async function listServices(publicOnly = false): Promise<CatalogServiceDto[]> {
  const rows = await prisma.catalogService.findMany({
    ...(publicOnly ? { where: { show: true } } : {}),
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  return rows.map(toServiceDto);
}

export async function createService(input: CatalogServiceInput): Promise<CatalogServiceDto> {
  return toServiceDto(await prisma.catalogService.create({ data: input }));
}

export async function updateService(id: number, input: CatalogServiceInput): Promise<CatalogServiceDto> {
  return toServiceDto(await prisma.catalogService.update({ where: { id }, data: input }));
}

export async function deleteService(id: number): Promise<void> {
  await prisma.catalogService.delete({ where: { id } });
}

export async function listPackings(publicOnly = false): Promise<CatalogPackingDto[]> {
  const rows = await prisma.catalogPacking.findMany({
    ...(publicOnly ? { where: { show: true } } : {}),
    orderBy: [{ sort: "asc" }, { id: "asc" }],
  });
  return rows.map(toPackingDto);
}

export async function createPacking(input: CatalogPackingInput): Promise<CatalogPackingDto> {
  return toPackingDto(await prisma.catalogPacking.create({ data: input }));
}

export async function updatePacking(id: number, input: CatalogPackingInput): Promise<CatalogPackingDto> {
  return toPackingDto(await prisma.catalogPacking.update({ where: { id }, data: input }));
}

export async function deletePacking(id: number): Promise<void> {
  await prisma.catalogPacking.delete({ where: { id } });
}

export async function listOffers(): Promise<CatalogOfferDto[]> {
  const rows = await prisma.catalogOffer.findMany({ orderBy: [{ sort: "asc" }, { trucks: "asc" }, { workers: "asc" }, { includedHours: "asc" }] });
  return rows.map(toOfferDto);
}

export async function createOffer(input: CatalogOfferInput): Promise<CatalogOfferDto> {
  return toOfferDto(await prisma.catalogOffer.create({ data: input }));
}

export async function updateOffer(id: number, input: CatalogOfferInput): Promise<CatalogOfferDto> {
  return toOfferDto(await prisma.catalogOffer.update({ where: { id }, data: input }));
}

export async function deleteOffer(id: number): Promise<void> {
  await prisma.catalogOffer.delete({ where: { id } });
}

export async function listServiceRates(): Promise<CatalogServiceRateDto[]> {
  const rows = await prisma.catalogServiceRate.findMany({ orderBy: { key: "asc" } });
  return rows
    .filter((row) => SERVICE_RATE_KEYS.includes(row.key as ServiceRateKey))
    .map((row) => ({ key: row.key as ServiceRateKey, price: Number(row.price) }));
}

export async function updateServiceRate(key: ServiceRateKey, price: number): Promise<CatalogServiceRateDto> {
  const row = await prisma.catalogServiceRate.upsert({
    where: { key },
    create: { key, price },
    update: { price },
  });
  return { key: row.key as ServiceRateKey, price: Number(row.price) };
}
