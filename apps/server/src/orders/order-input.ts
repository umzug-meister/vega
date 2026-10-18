import type {
  CreateOrderInput,
  OrderAddressInput,
  OrderConditionInput,
  OrderDetailsInput,
  OrderFurnitureInput,
  OrderPricingSnapshot,
  OrderServiceInput,
} from "@vega/domain";
import {
  addInvoiceAmounts,
  isValidEmailAddress,
  MAX_TRUCKS,
  SERVICE_RATE_KEYS,
} from "@vega/domain";

export interface OrderInputIssue {
  field: string;
  message: string;
}

export type OrderInputValidation =
  | { ok: true; value: CreateOrderInput }
  | { ok: false; issues: OrderInputIssue[] };

export class OrderInputError extends Error {
  constructor(readonly issues: OrderInputIssue[]) {
    super("INVALID_ORDER");
  }
}

const MAX_FURNITURE_VOLUME = 100_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^\d{2}:\d{2}$/u;
const ORDER_SOURCES = [
  "express",
  "individuelle",
  "Moebelliste",
  "UmzugRuckZuck",
  "check24",
  "umzugruckzuck24.de",
] as const;
const BUILDING_TYPES = ["Wohnung", "Haus", "Keller", "Lager", "Büro"] as const;
const LIFT_TYPES = [
  "kein Aufzug",
  "2 Personen",
  "4 Personen",
  "6 Personen",
  "8+ Personen",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasUnchangedCustomerDateRange(
  input: Pick<CreateOrderInput, "dateFrom" | "dateTo">,
  storedData: unknown,
): boolean {
  const stored = isRecord(storedData) ? storedData : {};
  return (["dateFrom", "dateTo"] as const).every(
    (field) =>
      (input[field] ?? "") ===
      (typeof stored[field] === "string" ? stored[field] : ""),
  );
}

function text(
  source: Record<string, unknown>,
  key: string,
  field: string,
  issues: OrderInputIssue[],
  { required = false, max = 200 }: { required?: boolean; max?: number } = {},
): string | undefined {
  const value = source[key];
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") {
    issues.push({
      field,
      message: required ? "Dieses Feld ist erforderlich." : "Ungültiger Wert.",
    });
    return undefined;
  }
  const trimmed = value.trim();
  if (required && !trimmed)
    issues.push({ field, message: "Dieses Feld ist erforderlich." });
  if (trimmed.length > max)
    issues.push({ field, message: `Maximal ${max} Zeichen erlaubt.` });
  return trimmed;
}

function numeric(
  source: Record<string, unknown>,
  key: string,
  field: string,
  issues: OrderInputIssue[],
  {
    required = false,
    max = 1_000_000,
  }: { required?: boolean; max?: number } = {},
): number | undefined {
  const value = source[key];
  if (value === undefined && !required) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max
  ) {
    issues.push({
      field,
      message: `Bitte geben Sie eine Zahl zwischen 0 und ${max} ein.`,
    });
    return undefined;
  }
  return value;
}

function bool(
  source: Record<string, unknown>,
  key: string,
  field: string,
  issues: OrderInputIssue[],
): boolean | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    issues.push({ field, message: "Ungültiger Wert." });
    return undefined;
  }
  return value;
}

function validateAddress(
  value: unknown,
  prefix: string,
  issues: OrderInputIssue[],
  allowIncomplete: boolean,
): OrderAddressInput | undefined {
  if (!isRecord(value)) {
    if (allowIncomplete) return { street: "", postalCode: "", city: "" };
    issues.push({
      field: prefix,
      message: "Bitte geben Sie eine vollständige Adresse ein.",
    });
    return undefined;
  }
  const street = text(value, "street", `${prefix}.street`, issues, {
    required: !allowIncomplete,
    max: 160,
  });
  const postalCode = text(value, "postalCode", `${prefix}.postalCode`, issues, {
    required: !allowIncomplete,
    max: 16,
  });
  const city = text(value, "city", `${prefix}.city`, issues, {
    required: !allowIncomplete,
    max: 100,
  });
  const floor = text(value, "floor", `${prefix}.floor`, issues, { max: 80 });
  const runningDistance = text(
    value,
    "runningDistance",
    `${prefix}.runningDistance`,
    issues,
    { max: 32 },
  );
  const rawMovementObject = value.movementObject;
  let movementObject: OrderAddressInput["movementObject"];
  if (rawMovementObject !== undefined) {
    if (
      typeof rawMovementObject === "string" &&
      BUILDING_TYPES.includes(
        rawMovementObject as (typeof BUILDING_TYPES)[number],
      )
    ) {
      movementObject = rawMovementObject as NonNullable<
        OrderAddressInput["movementObject"]
      >;
    } else
      issues.push({
        field: `${prefix}.movementObject`,
        message: "Ungültige Objektart.",
      });
  }
  const liftType = text(value, "liftType", `${prefix}.liftType`, issues, {
    max: 32,
  });
  if (liftType && !LIFT_TYPES.includes(liftType as (typeof LIFT_TYPES)[number]))
    issues.push({
      field: `${prefix}.liftType`,
      message: "Ungültiger Aufzugtyp.",
    });
  const area = text(value, "area", `${prefix}.area`, issues, { max: 16 });
  const roomsNumber = text(
    value,
    "roomsNumber",
    `${prefix}.roomsNumber`,
    issues,
    { max: 16 },
  );
  const roomsToRelocate = numeric(
    value,
    "roomsToRelocate",
    `${prefix}.roomsToRelocate`,
    issues,
    { max: 100 },
  );
  const kitchenWidth = numeric(
    value,
    "kitchenWidth",
    `${prefix}.kitchenWidth`,
    issues,
    { max: 1000 },
  );
  const wardrobeWidth = numeric(
    value,
    "wardrobeWidth",
    `${prefix}.wardrobeWidth`,
    issues,
    { max: 1000 },
  );
  const bedNumber = numeric(value, "bedNumber", `${prefix}.bedNumber`, issues, {
    max: 500,
  });
  const booleanFields = [
    "parkingSlot",
    "isAltbau",
    "hasLoft",
    "hasBasement",
    "hasGarage",
    "packservice",
    "demontage",
    "montage",
    "bulky",
  ] as const;
  const booleanValues = Object.fromEntries(
    booleanFields.map((key) => [
      key,
      bool(value, key, `${prefix}.${key}`, issues),
    ]),
  );
  const rawFloors = value.stockwerke;
  let stockwerke: string[] | undefined;
  if (rawFloors !== undefined) {
    if (
      !Array.isArray(rawFloors) ||
      rawFloors.length > 20 ||
      rawFloors.some((entry) => typeof entry !== "string" || entry.length > 40)
    ) {
      issues.push({
        field: `${prefix}.stockwerke`,
        message: "Ungültige Etagenliste.",
      });
    } else stockwerke = rawFloors.map((entry) => (entry as string).trim());
  }
  if (street === undefined || postalCode === undefined || city === undefined) {
    if (allowIncomplete)
      return {
        street: street ?? "",
        postalCode: postalCode ?? "",
        city: city ?? "",
      };
    return undefined;
  }
  return {
    street,
    postalCode,
    city,
    ...(floor !== undefined ? { floor } : {}),
    ...(runningDistance !== undefined ? { runningDistance } : {}),
    ...(movementObject !== undefined ? { movementObject } : {}),
    ...(liftType !== undefined ? { liftType } : {}),
    ...(area !== undefined ? { area } : {}),
    ...(roomsNumber !== undefined ? { roomsNumber } : {}),
    ...(roomsToRelocate !== undefined ? { roomsToRelocate } : {}),
    ...(kitchenWidth !== undefined ? { kitchenWidth } : {}),
    ...(wardrobeWidth !== undefined ? { wardrobeWidth } : {}),
    ...(bedNumber !== undefined ? { bedNumber } : {}),
    ...(stockwerke !== undefined ? { stockwerke } : {}),
    ...(booleanValues.parkingSlot !== undefined
      ? { parkingSlot: booleanValues.parkingSlot }
      : {}),
    ...(booleanValues.isAltbau !== undefined
      ? { isAltbau: booleanValues.isAltbau }
      : {}),
    ...(booleanValues.hasLoft !== undefined
      ? { hasLoft: booleanValues.hasLoft }
      : {}),
    ...(booleanValues.hasBasement !== undefined
      ? { hasBasement: booleanValues.hasBasement }
      : {}),
    ...(booleanValues.hasGarage !== undefined
      ? { hasGarage: booleanValues.hasGarage }
      : {}),
    ...(booleanValues.packservice !== undefined
      ? { packservice: booleanValues.packservice }
      : {}),
    ...(booleanValues.demontage !== undefined
      ? { demontage: booleanValues.demontage }
      : {}),
    ...(booleanValues.montage !== undefined
      ? { montage: booleanValues.montage }
      : {}),
    ...(booleanValues.bulky !== undefined
      ? { bulky: booleanValues.bulky }
      : {}),
  };
}

function validDate(value: string, field: string, issues: OrderInputIssue[]) {
  const parsed = DATE_PATTERN.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (
    !parsed ||
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    issues.push({ field, message: "Bitte geben Sie ein gültiges Datum ein." });
  }
}

function validateFurniture(
  value: unknown,
  issues: OrderInputIssue[],
): OrderDetailsInput["furniture"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      field: "details.furniture",
      message: "Ungültige Möbelliste.",
    });
    return undefined;
  }
  const volume = numeric(value, "volume", "details.furniture.volume", issues, {
    required: true,
    max: MAX_FURNITURE_VOLUME,
  });
  const volumeComplete = bool(
    value,
    "volumeComplete",
    "details.furniture.volumeComplete",
    issues,
  );
  const boxes = numeric(value, "boxes", "details.furniture.boxes", issues, {
    required: true,
    max: 100000,
  });
  const wardrobeBoxes = numeric(
    value,
    "wardrobeBoxes",
    "details.furniture.wardrobeBoxes",
    issues,
    { required: true, max: 100000 },
  );
  const ownItems = text(
    value,
    "ownItems",
    "details.furniture.ownItems",
    issues,
    { max: 10000 },
  );
  const expensiveText = text(
    value,
    "expensiveText",
    "details.furniture.expensiveText",
    issues,
    { max: 3000 },
  );
  const heavyText = text(
    value,
    "heavyText",
    "details.furniture.heavyText",
    issues,
    { max: 3000 },
  );
  const bulkyText = text(
    value,
    "bulkyText",
    "details.furniture.bulkyText",
    issues,
    { max: 3000 },
  );
  const expensive = bool(
    value,
    "expensive",
    "details.furniture.expensive",
    issues,
  );
  const heavy = bool(value, "heavy", "details.furniture.heavy", issues);
  const bulky = bool(value, "bulky", "details.furniture.bulky", issues);
  const rawItems = value.items;
  const items: OrderFurnitureInput[] = [];
  if (!Array.isArray(rawItems) || rawItems.length > 200)
    issues.push({
      field: "details.furniture.items",
      message: "Ungültige Möbelliste.",
    });
  else
    rawItems.forEach((rawItem, index) => {
      if (!isRecord(rawItem)) {
        issues.push({
          field: `details.furniture.items.${index}`,
          message: "Ungültige Möbelposition.",
        });
        return;
      }
      const name = text(
        rawItem,
        "name",
        `details.furniture.items.${index}.name`,
        issues,
        { required: true, max: 191 },
      );
      const quantity = numeric(
        rawItem,
        "quantity",
        `details.furniture.items.${index}.quantity`,
        issues,
        { required: true, max: 100000 },
      );
      const itemVolume = numeric(
        rawItem,
        "volume",
        `details.furniture.items.${index}.volume`,
        issues,
        { max: 100000 },
      );
      const category = text(
        rawItem,
        "category",
        `details.furniture.items.${index}.category`,
        issues,
        { max: 191 },
      );
      const catalogId =
        rawItem.catalogId === undefined
          ? undefined
          : numeric(
              rawItem,
              "catalogId",
              `details.furniture.items.${index}.catalogId`,
              issues,
              { required: true, max: 2_147_483_647 },
            );
      if (
        catalogId !== undefined &&
        (!Number.isInteger(catalogId) || catalogId < 1)
      ) {
        issues.push({
          field: `details.furniture.items.${index}.catalogId`,
          message: "Ungültige Katalogreferenz.",
        });
      }
      if (name !== undefined && quantity !== undefined)
        items.push({
          name,
          quantity,
          ...(itemVolume !== undefined ? { volume: itemVolume } : {}),
          ...(category !== undefined ? { category } : {}),
          ...(catalogId !== undefined ? { catalogId } : {}),
        });
    });
  const itemVolumeTotal = items.reduce(
    (total, item) => total + item.quantity * (item.volume ?? 0),
    0,
  );
  if (
    !Number.isFinite(itemVolumeTotal) ||
    itemVolumeTotal > MAX_FURNITURE_VOLUME
  ) {
    issues.push({
      field: "details.furniture.items",
      message: `Das Gesamtvolumen der Möbel darf ${MAX_FURNITURE_VOLUME} m³ nicht überschreiten.`,
    });
  }
  if (
    volume === undefined ||
    boxes === undefined ||
    wardrobeBoxes === undefined ||
    ownItems === undefined ||
    expensiveText === undefined ||
    heavyText === undefined ||
    bulkyText === undefined ||
    expensive === undefined ||
    heavy === undefined ||
    bulky === undefined
  )
    return undefined;
  return {
    volume,
    boxes,
    wardrobeBoxes,
    ownItems,
    items,
    expensive,
    expensiveText,
    heavy,
    heavyText,
    bulky,
    bulkyText,
    ...(volumeComplete !== undefined ? { volumeComplete } : {}),
  };
}

function validateExtras(
  value: unknown,
  issues: OrderInputIssue[],
  allowStaffPricing: boolean,
): OrderDetailsInput["extras"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      field: "details.extras",
      message: "Ungültige Zusatzleistungen.",
    });
    return undefined;
  }
  const packingRequested = bool(
    value,
    "packingRequested",
    "details.extras.packingRequested",
    issues,
  );
  const rawServices = value.services;
  const services: OrderServiceInput[] = [];
  if (!Array.isArray(rawServices) || rawServices.length > 200)
    issues.push({
      field: "details.extras.services",
      message: "Ungültige Leistungsliste.",
    });
  else
    rawServices.forEach((rawService, index) => {
      if (!isRecord(rawService)) {
        issues.push({
          field: `details.extras.services.${index}`,
          message: "Ungültige Leistung.",
        });
        return;
      }
      const name = text(
        rawService,
        "name",
        `details.extras.services.${index}.name`,
        issues,
        { required: true, max: 191 },
      );
      const quantity = numeric(
        rawService,
        "quantity",
        `details.extras.services.${index}.quantity`,
        issues,
        { required: true, max: 100000 },
      );
      const unitPrice =
        rawService.unitPrice === undefined
          ? undefined
          : numeric(
              rawService,
              "unitPrice",
              `details.extras.services.${index}.unitPrice`,
              issues,
              { max: 1_000_000 },
            );
      if (!allowStaffPricing && unitPrice !== undefined) {
        issues.push({
          field: `details.extras.services.${index}.unitPrice`,
          message:
            "Einzelpreise sind nur für angemeldete Mitarbeiter verfügbar.",
        });
      }
      const kind = rawService.kind;
      const catalogId =
        rawService.catalogId === undefined
          ? undefined
          : numeric(
              rawService,
              "catalogId",
              `details.extras.services.${index}.catalogId`,
              issues,
              { required: true, max: 2_147_483_647 },
            );
      if (
        catalogId !== undefined &&
        (!Number.isInteger(catalogId) || catalogId < 1)
      ) {
        issues.push({
          field: `details.extras.services.${index}.catalogId`,
          message: "Ungültige Katalogreferenz.",
        });
      }
      if (kind !== "packaging" && kind !== "service")
        issues.push({
          field: `details.extras.services.${index}.kind`,
          message: "Ungültige Leistungsart.",
        });
      if (
        name !== undefined &&
        quantity !== undefined &&
        (kind === "packaging" || kind === "service")
      )
        services.push({
          name,
          quantity,
          kind,
          ...(catalogId !== undefined ? { catalogId } : {}),
          ...(unitPrice !== undefined ? { unitPrice } : {}),
        });
    });
  return packingRequested === undefined
    ? undefined
    : { packingRequested, services };
}

function validateBasis(
  value: unknown,
  issues: OrderInputIssue[],
  allowStaffPricing: boolean,
): OrderDetailsInput["basis"] | undefined {
  if (!isRecord(value)) {
    issues.push({
      field: "details.basis",
      message: "Ungültige Angebotsbasis.",
    });
    return undefined;
  }
  const workers = numeric(value, "workers", "details.basis.workers", issues, {
    required: true,
    max: 1000,
  });
  const trucks = numeric(value, "trucks", "details.basis.trucks", issues, {
    required: true,
    max: MAX_TRUCKS,
  });
  const hours = numeric(value, "hours", "details.basis.hours", issues, {
    required: true,
    max: 10000,
  });
  const basePrice = numeric(
    value,
    "basePrice",
    "details.basis.basePrice",
    issues,
    { required: true, max: 10_000_000 },
  );
  const extraHourPrice = numeric(
    value,
    "extraHourPrice",
    "details.basis.extraHourPrice",
    issues,
    { required: true, max: 1_000_000 },
  );
  const discountPercent = numeric(
    value,
    "discountPercent",
    "details.basis.discountPercent",
    issues,
    { required: true, max: 100 },
  );
  const offerId =
    value.offerId === undefined
      ? undefined
      : numeric(value, "offerId", "details.basis.offerId", issues, {
          required: true,
          max: 2_147_483_647,
        });
  if (offerId !== undefined && (!Number.isInteger(offerId) || offerId < 1))
    issues.push({
      field: "details.basis.offerId",
      message: "Ungültige Tarifreferenz.",
    });
  if (
    !allowStaffPricing &&
    ((basePrice ?? 0) > 0 ||
      (extraHourPrice ?? 0) > 0 ||
      (discountPercent ?? 0) > 0)
  ) {
    issues.push({
      field: "details.basis",
      message:
        "Preis- und Rabattangaben sind nur für angemeldete Mitarbeiter verfügbar.",
    });
  }
  if (!allowStaffPricing && offerId !== undefined)
    issues.push({
      field: "details.basis.offerId",
      message: "Tarifauswahl ist nur für angemeldete Mitarbeiter verfügbar.",
    });
  if (
    workers === undefined ||
    trucks === undefined ||
    hours === undefined ||
    basePrice === undefined ||
    extraHourPrice === undefined ||
    discountPercent === undefined
  )
    return undefined;
  return {
    workers,
    trucks,
    hours,
    basePrice,
    extraHourPrice,
    discountPercent,
    ...(offerId !== undefined ? { offerId } : {}),
  };
}

function validateConditions(
  value: unknown,
  issues: OrderInputIssue[],
  allowStaffPricing: boolean,
): OrderConditionInput[] | undefined {
  if (!Array.isArray(value) || value.length > 200) {
    issues.push({
      field: "details.conditions",
      message: "Ungültige Positionen.",
    });
    return undefined;
  }
  const conditions: OrderConditionInput[] = [];
  value.forEach((rawCondition, index) => {
    if (!isRecord(rawCondition)) {
      issues.push({
        field: `details.conditions.${index}`,
        message: "Ungültige Kondition.",
      });
      return;
    }
    const description = text(
      rawCondition,
      "description",
      `details.conditions.${index}.description`,
      issues,
      { required: true, max: 500 },
    );
    const rawAmount = rawCondition.amount;
    const amount =
      typeof rawAmount === "number" &&
      Number.isFinite(rawAmount) &&
      Math.abs(rawAmount) <= 10_000_000
        ? rawAmount
        : (issues.push({
            field: `details.conditions.${index}.amount`,
            message: "Bitte geben Sie einen gültigen Betrag ein.",
          }),
          undefined);
    const rawKind = rawCondition.kind;
    const allowedKinds = [
      "manual",
      "base",
      "discount",
      "travel",
      "parking",
      "services",
      "packaging",
    ] as const;
    const kind =
      rawKind === undefined
        ? undefined
        : typeof rawKind === "string" &&
            allowedKinds.includes(rawKind as (typeof allowedKinds)[number])
          ? (rawKind as NonNullable<OrderConditionInput["kind"]>)
          : (issues.push({
              field: `details.conditions.${index}.kind`,
              message: "Ungültige Konditionsart.",
            }),
            undefined);
    if (
      amount !== undefined &&
      amount < 0 &&
      (kind !== "discount" || !allowStaffPricing)
    ) {
      issues.push({
        field: `details.conditions.${index}.amount`,
        message:
          "Negative Beträge sind nur für serverseitig berechnete Rabatte erlaubt.",
      });
    }
    if (amount !== undefined && kind === "discount" && amount > 0)
      issues.push({
        field: `details.conditions.${index}.amount`,
        message: "Ein Rabatt muss einen negativen Betrag haben.",
      });
    if (kind !== undefined && kind !== "manual" && !allowStaffPricing)
      issues.push({
        field: `details.conditions.${index}.kind`,
        message:
          "Berechnete Positionen sind nur für angemeldete Mitarbeiter verfügbar.",
      });
    if (!allowStaffPricing && (amount ?? 0) > 0)
      issues.push({
        field: `details.conditions.${index}.amount`,
        message: "Preisangaben sind nur für angemeldete Mitarbeiter verfügbar.",
      });
    if (description !== undefined && amount !== undefined)
      conditions.push({
        description,
        amount,
        ...(kind !== undefined ? { kind } : {}),
      });
  });
  if (addInvoiceAmounts(conditions.map((condition) => condition.amount)) < 0)
    issues.push({
      field: "details.conditions",
      message: "Die Angebotssumme darf nicht negativ sein.",
    });
  return conditions;
}

function validateDetails(
  value: unknown,
  issues: OrderInputIssue[],
  allowStaffPricing: boolean,
  allowIncomplete: boolean,
): OrderDetailsInput | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    issues.push({ field: "details", message: "Ungültige Auftragsdetails." });
    return undefined;
  }
  const showSecondaryFrom = bool(
    value,
    "showSecondaryFrom",
    "details.showSecondaryFrom",
    issues,
  );
  const showSecondaryTo = bool(
    value,
    "showSecondaryTo",
    "details.showSecondaryTo",
    issues,
  );
  const distanceKm = numeric(
    value,
    "distanceKm",
    "details.distanceKm",
    issues,
    { required: true, max: 10000 },
  );
  const rawDistanceSource = value.distanceSource;
  const distanceSource =
    rawDistanceSource === undefined
      ? undefined
      : rawDistanceSource === "manual" || rawDistanceSource === "route"
        ? rawDistanceSource
        : (issues.push({
            field: "details.distanceSource",
            message: "Ungültige Entfernungsquelle.",
          }),
          undefined);
  const rawRouteSnapshot = value.routeSnapshot;
  let routeSnapshot: OrderDetailsInput["routeSnapshot"];
  if (rawRouteSnapshot !== undefined) {
    const routePath = "details.routeSnapshot";
    if (!allowStaffPricing) {
      issues.push({
        field: routePath,
        message:
          "Routenberechnungen sind nur für angemeldete Mitarbeiter verfügbar.",
      });
    } else if (!isRecord(rawRouteSnapshot)) {
      issues.push({ field: routePath, message: "Ungültiger Routensnapshot." });
    } else {
      const { calculatedAt, origin, addresses, legs } = rawRouteSnapshot;
      const totalDistanceKm = numeric(
        rawRouteSnapshot,
        "distanceKm",
        `${routePath}.distanceKm`,
        issues,
        { required: true, max: 10000 },
      );
      const totalDurationMinutes = numeric(
        rawRouteSnapshot,
        "durationMinutes",
        `${routePath}.durationMinutes`,
        issues,
        { required: true, max: 166667 },
      );
      const validTimestamp =
        typeof calculatedAt === "string" &&
        calculatedAt.length <= 40 &&
        Number.isFinite(Date.parse(calculatedAt));
      const validOrigin =
        typeof origin === "string" &&
        origin.trim().length > 0 &&
        origin.length <= 300;
      const validAddresses =
        Array.isArray(addresses) &&
        addresses.length >= 2 &&
        addresses.length <= 4 &&
        addresses.every(
          (address) =>
            typeof address === "string" &&
            address.trim().length > 0 &&
            address.length <= 400,
        );
      const validLegs =
        Array.isArray(legs) &&
        validAddresses &&
        legs.length === addresses.length + 1 &&
        legs.length <= 5;
      if (!validTimestamp)
        issues.push({
          field: `${routePath}.calculatedAt`,
          message: "Ungültiger Berechnungszeitpunkt.",
        });
      if (!validOrigin)
        issues.push({
          field: `${routePath}.origin`,
          message: "Ungültiger Betriebsstandort.",
        });
      if (!validAddresses)
        issues.push({
          field: `${routePath}.addresses`,
          message: "Ungültige Routenadressen.",
        });
      const normalizedLegs: NonNullable<
        OrderDetailsInput["routeSnapshot"]
      >["legs"] = [];
      if (!validLegs)
        issues.push({
          field: `${routePath}.legs`,
          message: "Ungültige Routenabschnitte.",
        });
      else
        legs.forEach((leg, index) => {
          const legPath = `${routePath}.legs.${index}`;
          if (!isRecord(leg)) {
            issues.push({
              field: legPath,
              message: "Ungültiger Routenabschnitt.",
            });
            return;
          }
          const distanceKm = numeric(
            leg,
            "distanceKm",
            `${legPath}.distanceKm`,
            issues,
            { required: true, max: 10000 },
          );
          const durationMinutes = numeric(
            leg,
            "durationMinutes",
            `${legPath}.durationMinutes`,
            issues,
            { required: true, max: 166667 },
          );
          if (distanceKm !== undefined && durationMinutes !== undefined)
            normalizedLegs.push({ distanceKm, durationMinutes });
        });
      if (
        validTimestamp &&
        validOrigin &&
        validAddresses &&
        validLegs &&
        totalDistanceKm !== undefined &&
        totalDurationMinutes !== undefined &&
        normalizedLegs.length === legs.length
      ) {
        routeSnapshot = {
          calculatedAt,
          origin: origin.trim(),
          addresses: addresses.map((address) => address.trim()),
          distanceKm: totalDistanceKm,
          durationMinutes: totalDurationMinutes,
          legs: normalizedLegs,
        };
      }
    }
  }
  if (!allowStaffPricing && distanceSource !== undefined) {
    issues.push({
      field: "details.distanceSource",
      message:
        "Die Entfernungsquelle ist nur für angemeldete Mitarbeiter verfügbar.",
    });
  }
  const secondaryFrom =
    value.secondaryFrom === undefined
      ? undefined
      : validateAddress(
          value.secondaryFrom,
          "details.secondaryFrom",
          issues,
          allowIncomplete,
        );
  const secondaryTo =
    value.secondaryTo === undefined
      ? undefined
      : validateAddress(
          value.secondaryTo,
          "details.secondaryTo",
          issues,
          allowIncomplete,
        );
  const furniture = validateFurniture(value.furniture, issues);
  const extras = validateExtras(value.extras, issues, allowStaffPricing);
  const basis = validateBasis(value.basis, issues, allowStaffPricing);
  const conditions = validateConditions(
    value.conditions,
    issues,
    allowStaffPricing,
  );
  if (
    showSecondaryFrom === undefined ||
    showSecondaryTo === undefined ||
    distanceKm === undefined ||
    !furniture ||
    !extras ||
    !basis ||
    !conditions
  )
    return undefined;
  if (showSecondaryFrom && !secondaryFrom && !allowIncomplete)
    issues.push({
      field: "details.secondaryFrom",
      message: "Bitte geben Sie die zweite Beladestelle ein.",
    });
  if (showSecondaryTo && !secondaryTo && !allowIncomplete)
    issues.push({
      field: "details.secondaryTo",
      message: "Bitte geben Sie die zweite Entladestelle ein.",
    });
  return {
    showSecondaryFrom,
    showSecondaryTo,
    distanceKm,
    ...(distanceSource !== undefined ? { distanceSource } : {}),
    ...(routeSnapshot !== undefined ? { routeSnapshot } : {}),
    furniture,
    extras,
    basis,
    conditions,
    ...(showSecondaryFrom && secondaryFrom ? { secondaryFrom } : {}),
    ...(showSecondaryTo && secondaryTo ? { secondaryTo } : {}),
  };
}

function isPricingSnapshot(value: unknown): value is OrderPricingSnapshot {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.calculatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.calculatedAt))
  )
    return false;
  const source = value.source;
  if (
    !isRecord(source) ||
    !(
      source.offerId === null ||
      (Number.isInteger(source.offerId) && Number(source.offerId) > 0)
    ) ||
    ![
      "workers",
      "trucks",
      "hours",
      "basePrice",
      "extraHourPrice",
      "discountPercent",
      "distanceKm",
    ].every(
      (key) => typeof source[key] === "number" && Number.isFinite(source[key]),
    ) ||
    !Array.isArray(source.addresses) ||
    source.addresses.length > 4 ||
    !source.addresses.every(
      (address) =>
        isRecord(address) &&
        typeof address.city === "string" &&
        address.city.length <= 100 &&
        typeof address.parkingSlot === "boolean",
    ) ||
    !Array.isArray(source.services) ||
    source.services.length > 200 ||
    !source.services.every(
      (service) =>
        isRecord(service) &&
        (service.kind === "service" || service.kind === "packaging") &&
        (service.catalogId === null ||
          (Number.isInteger(service.catalogId) &&
            Number(service.catalogId) > 0)) &&
        typeof service.quantity === "number" &&
        Number.isFinite(service.quantity) &&
        (service.unitPrice === undefined ||
          service.unitPrice === null ||
          (typeof service.unitPrice === "number" &&
            Number.isFinite(service.unitPrice) &&
            service.unitPrice >= 0 &&
            service.unitPrice <= 1_000_000)),
    )
  )
    return false;
  if (
    source.distanceSource !== undefined &&
    source.distanceSource !== "manual" &&
    source.distanceSource !== "route"
  )
    return false;
  const offer = value.offer;
  if (
    offer !== null &&
    (!isRecord(offer) ||
      !Number.isInteger(offer.id) ||
      typeof offer.name !== "string" ||
      ![
        "workers",
        "trucks",
        "includedHours",
        "sum",
        "hourPrice",
        "ridingCosts",
        "sort",
      ].every(
        (key) => typeof offer[key] === "number" && Number.isFinite(offer[key]),
      ))
  )
    return false;
  if (
    !Array.isArray(value.rates) ||
    value.rates.length > SERVICE_RATE_KEYS.length ||
    !value.rates.every(
      (rate) =>
        isRecord(rate) &&
        typeof rate.key === "string" &&
        SERVICE_RATE_KEYS.includes(
          rate.key as (typeof SERVICE_RATE_KEYS)[number],
        ) &&
        typeof rate.price === "number" &&
        Number.isFinite(rate.price) &&
        rate.price >= 0 &&
        rate.price <= 10_000_000,
    )
  )
    return false;
  return (
    Array.isArray(value.services) &&
    value.services.length <= 1000 &&
    value.services.every(
      (service) =>
        isRecord(service) &&
        Number.isInteger(service.id) &&
        Number(service.id) > 0 &&
        (service.kind === "service" || service.kind === "packaging") &&
        typeof service.name === "string" &&
        service.name.length <= 191 &&
        typeof service.price === "number" &&
        Number.isFinite(service.price) &&
        service.price >= 0 &&
        service.price <= 10_000_000 &&
        Number.isInteger(service.sort) &&
        Number(service.sort) >= 0,
    )
  );
}

export function validateOrderCreateInput(
  body: unknown,
  {
    allowStaffPricing = false,
    allowIncomplete = false,
  }: { allowStaffPricing?: boolean; allowIncomplete?: boolean } = {},
): OrderInputValidation {
  const issues: OrderInputIssue[] = [];
  if (!isRecord(body))
    return {
      ok: false,
      issues: [{ field: "body", message: "Ungültige Anfrage." }],
    };
  const customerValue = body.customer;
  if (!isRecord(customerValue))
    return {
      ok: false,
      issues: [
        { field: "customer", message: "Bitte geben Sie die Kundendaten ein." },
      ],
    };

  const firstName = text(
    customerValue,
    "firstName",
    "customer.firstName",
    issues,
    { required: !allowIncomplete, max: 100 },
  );
  const lastName = text(
    customerValue,
    "lastName",
    "customer.lastName",
    issues,
    { required: !allowIncomplete, max: 100 },
  );
  const phone = text(customerValue, "phone", "customer.phone", issues, {
    required: !allowIncomplete,
    max: 64,
  });
  const company = text(customerValue, "company", "customer.company", issues, {
    max: 160,
  });
  const email = text(customerValue, "email", "customer.email", issues, {
    max: 254,
  });
  const rawSalutation = customerValue.salutation;
  let salutation: CreateOrderInput["customer"]["salutation"];
  if (rawSalutation !== undefined) {
    if (
      rawSalutation === "Herr" ||
      rawSalutation === "Frau" ||
      rawSalutation === "Divers" ||
      rawSalutation === ""
    )
      salutation = rawSalutation;
    else
      issues.push({
        field: "customer.salutation",
        message: "Ungültige Anrede.",
      });
  }

  if (email && !isValidEmailAddress(email))
    issues.push({
      field: "customer.email",
      message: "Bitte geben Sie eine gültige E-Mail-Adresse ein.",
    });
  if (phone && !/[0-9]{3}/u.test(phone))
    issues.push({
      field: "customer.phone",
      message: "Bitte geben Sie eine gültige Telefonnummer ein.",
    });

  const from = validateAddress(body.from, "from", issues, allowIncomplete);
  const to = validateAddress(body.to, "to", issues, allowIncomplete);
  const movingDate = text(body, "movingDate", "movingDate", issues, {
    required: !allowIncomplete,
    max: 10,
  });
  const movingTime = text(body, "movingTime", "movingTime", issues, { max: 5 });
  const dateFrom = text(body, "dateFrom", "dateFrom", issues, { max: 10 });
  const dateTo = text(body, "dateTo", "dateTo", issues, { max: 10 });
  const dateFixed = bool(body, "dateFixed", "dateFixed", issues);
  const rawOrderSource = body.orderSource;
  let orderSource: CreateOrderInput["orderSource"];
  if (rawOrderSource !== undefined) {
    if (
      typeof rawOrderSource === "string" &&
      ORDER_SOURCES.includes(rawOrderSource as (typeof ORDER_SOURCES)[number])
    )
      orderSource = rawOrderSource as NonNullable<
        CreateOrderInput["orderSource"]
      >;
    else
      issues.push({
        field: "orderSource",
        message: "Ungültige Auftragsquelle.",
      });
  }
  const note = text(body, "note", "note", issues, { max: 5000 });
  const costsAssumption = bool(
    body,
    "costsAssumption",
    "costsAssumption",
    issues,
  );
  const details = validateDetails(
    body.details,
    issues,
    allowStaffPricing,
    allowIncomplete,
  );
  let pricingSnapshot: OrderPricingSnapshot | undefined;
  if (body.pricingSnapshot !== undefined) {
    if (!allowStaffPricing)
      issues.push({
        field: "pricingSnapshot",
        message: "Preisstände sind nur für angemeldete Mitarbeiter verfügbar.",
      });
    else if (!isPricingSnapshot(body.pricingSnapshot))
      issues.push({
        field: "pricingSnapshot",
        message: "Ungültiger Preisstand.",
      });
    else pricingSnapshot = body.pricingSnapshot;
  }
  const privacyAccepted = bool(
    body,
    "privacyAccepted",
    "privacyAccepted",
    issues,
  );
  const visitWanted = bool(body, "visitWanted", "visitWanted", issues);
  let imageClaims: CreateOrderInput["imageClaims"];
  if (body.imageClaims !== undefined) {
    if (
      !Array.isArray(body.imageClaims) ||
      body.imageClaims.some(
        (claim) =>
          !isRecord(claim) ||
          typeof claim.id !== "string" ||
          !/^[a-f0-9-]{36}$/.test(claim.id) ||
          typeof claim.token !== "string" ||
          !/^[A-Za-z0-9_-]{43}$/.test(claim.token),
      )
    ) {
      issues.push({
        field: "imageClaims",
        message: "Ungültige Bildreferenzen.",
      });
    } else {
      imageClaims = body.imageClaims.map(
        (claim: { id: string; token: string }) => ({
          id: claim.id,
          token: claim.token,
        }),
      );
      if (
        new Set(imageClaims.map((claim) => claim.id)).size !==
        imageClaims.length
      )
        issues.push({
          field: "imageClaims",
          message: "Doppelte Bildreferenzen.",
        });
    }
  }

  if (movingDate) validDate(movingDate, "movingDate", issues);
  if (dateFrom) validDate(dateFrom, "dateFrom", issues);
  if (dateTo) validDate(dateTo, "dateTo", issues);
  if (dateFrom && dateTo && dateFrom > dateTo)
    issues.push({
      field: "dateTo",
      message: "Das Bis-Datum muss nach dem Von-Datum liegen.",
    });
  if (
    movingTime &&
    (!TIME_PATTERN.test(movingTime) ||
      Number(movingTime.slice(0, 2)) > 23 ||
      Number(movingTime.slice(3, 5)) > 59)
  ) {
    issues.push({
      field: "movingTime",
      message: "Bitte geben Sie eine gültige Uhrzeit ein.",
    });
  }

  const normalizedFirstName = firstName ?? (allowIncomplete ? "" : undefined);
  const normalizedLastName = lastName ?? (allowIncomplete ? "" : undefined);
  const normalizedPhone = phone ?? (allowIncomplete ? "" : undefined);
  const normalizedMovingDate = movingDate ?? (allowIncomplete ? "" : undefined);
  if (
    issues.length > 0 ||
    normalizedFirstName === undefined ||
    normalizedLastName === undefined ||
    normalizedPhone === undefined ||
    from === undefined ||
    to === undefined ||
    normalizedMovingDate === undefined
  ) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    value: {
      customer: {
        firstName: normalizedFirstName,
        lastName: normalizedLastName,
        phone: normalizedPhone,
        ...(company !== undefined ? { company } : {}),
        ...(email !== undefined ? { email } : {}),
        ...(salutation !== undefined ? { salutation } : {}),
      },
      from,
      to,
      movingDate: normalizedMovingDate,
      ...(privacyAccepted !== undefined ? { privacyAccepted } : {}),
      ...(visitWanted !== undefined ? { visitWanted } : {}),
      ...(imageClaims !== undefined ? { imageClaims } : {}),
      ...(movingTime !== undefined ? { movingTime } : {}),
      ...(dateFrom !== undefined ? { dateFrom } : {}),
      ...(dateTo !== undefined ? { dateTo } : {}),
      ...(dateFixed !== undefined ? { dateFixed } : {}),
      ...(orderSource !== undefined ? { orderSource } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(costsAssumption !== undefined ? { costsAssumption } : {}),
      ...(details !== undefined ? { details } : {}),
      ...(pricingSnapshot !== undefined ? { pricingSnapshot } : {}),
    },
  };
}

export function validateCustomerFormInput(
  input: CreateOrderInput,
): OrderInputIssue[] {
  const issues: OrderInputIssue[] = [];
  if (!input.customer.email)
    issues.push({
      field: "customer.email",
      message: "Die E-Mail-Adresse ist erforderlich.",
    });
  if (input.privacyAccepted !== true)
    issues.push({
      field: "privacyAccepted",
      message: "Bitte bestätigen Sie die Datenschutzerklärung.",
    });
  if (
    typeof input.dateFixed !== "boolean" ||
    (input.dateFixed === false && (!input.dateFrom || !input.dateTo))
  ) {
    issues.push({
      field: "dateFixed",
      message:
        "Bitte geben Sie den festen Termin oder den vollständigen Zeitraum ein.",
    });
  }
  if (!input.details)
    issues.push({
      field: "details",
      message: "Die Angaben zu Umzugsgut und Leistungen fehlen.",
    });
  for (const key of ["from", "to"] as const) {
    const address = input[key];
    if (!/.{1,50}\d.{0,5}/u.test(address.street))
      issues.push({
        field: `${key}.street`,
        message: "Straße und Hausnummer sind unvollständig.",
      });
    if (
      !address.movementObject ||
      !BUILDING_TYPES.includes(address.movementObject)
    )
      issues.push({
        field: `${key}.movementObject`,
        message: "Bitte wählen Sie die Objektart.",
      });
    if (
      !/^(?:10|20|30|40|50|60|70|80|90|100) m\.$/u.test(
        address.runningDistance ?? "",
      )
    )
      issues.push({
        field: `${key}.runningDistance`,
        message: "Bitte wählen Sie die Entfernung vom Parkplatz.",
      });
    if (address.movementObject !== "Haus") {
      if (!/^(?:UG|EG|[1-8]\. Etage|9\+ Etage)$/u.test(address.floor ?? ""))
        issues.push({
          field: `${key}.floor`,
          message: "Bitte wählen Sie das Stockwerk.",
        });
      if (
        !address.liftType ||
        !LIFT_TYPES.includes(address.liftType as (typeof LIFT_TYPES)[number])
      )
        issues.push({
          field: `${key}.liftType`,
          message: "Bitte wählen Sie den Fahrstuhl.",
        });
    } else if (
      address.stockwerke?.some(
        (floor) => !["UG", "EG", "1.OG", "2.OG"].includes(floor),
      )
    ) {
      issues.push({
        field: `${key}.stockwerke`,
        message: "Ungültige Stockwerke.",
      });
    }
  }
  if (
    !input.from.roomsNumber ||
    !Number.isFinite(Number(input.from.roomsNumber)) ||
    Number(input.from.roomsNumber) <= 0 ||
    Number(input.from.roomsNumber) > 100
  ) {
    issues.push({
      field: "from.roomsNumber",
      message: "Bitte geben Sie eine Zimmeranzahl zwischen 1 und 100 ein.",
    });
  }
  if (!/^(?:[1-9]0|1[0-5]0) m²$/u.test(input.from.area ?? ""))
    issues.push({
      field: "from.area",
      message: "Bitte wählen Sie die Wohnfläche.",
    });
  if (
    input.details?.furniture.items.some(
      (item) => item.catalogId === undefined,
    ) ||
    input.details?.extras.services.some((item) => item.catalogId === undefined)
  ) {
    issues.push({
      field: "details",
      message:
        "Bitte verwenden Sie ausschließlich freigegebene Katalogpositionen.",
    });
  }
  return issues;
}

export function validateOrderWriteInput(
  input: CreateOrderInput,
): CreateOrderInput {
  const validation = validateOrderCreateInput(input, {
    allowStaffPricing: true,
    allowIncomplete: true,
  });
  if (!validation.ok) throw new OrderInputError(validation.issues);
  return validation.value;
}
