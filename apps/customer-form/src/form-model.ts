import type {
  CatalogCategoryDto,
  CatalogFurnitureDto,
  CatalogPackingDto,
  CatalogServiceDto,
  CatalogServiceRateDto,
  CreateOrderInput,
  CustomerFormConfig,
  OrderAddressInput,
} from "@vega/domain";
import { isValidEmailAddress } from "@vega/domain";

export const movementObjects = ["Wohnung", "Haus", "Keller", "Lager", "Büro"];
export const parkingDistances = Array.from(
  { length: 10 },
  (_, i) => `${(i + 1) * 10} m.`,
);
export const floors = [
  "UG",
  "EG",
  ...Array.from({ length: 8 }, (_, i) => `${i + 1}. Etage`),
  "9+ Etage",
];
export const areas = Array.from({ length: 15 }, (_, i) => `${(i + 1) * 10} m²`);
export const liftTypes = [
  "kein Aufzug",
  "2 Personen",
  "4 Personen",
  "6 Personen",
  "8+ Personen",
];
export const steps = ["Kontakt", "Auszug", "Einzug", "Verpackung", "Fertig"];
export const paths = ["", "auszug", "einzug", "verpackung", "absenden"];
export const EMAIL_PATTERN = String.raw`^[^\s@]+@[^\s@.]+(?:\.[^\s@.]*)*\.[^\s@.]+$`;
export const euro = (value: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(
    value,
  );

export interface SpecialItem {
  id: string;
  name: string;
  quantity: string;
  width: string;
  depth: string;
  height: string;
  weight: string;
}
export interface AddressDraft extends Omit<
  OrderAddressInput,
  "kitchenWidth" | "wardrobeWidth" | "bedNumber" | "roomsToRelocate"
> {
  kitchenWidth: string;
  wardrobeWidth: string;
  bedNumber: string;
  roomsToRelocate: string;
}
export interface ImageDraft {
  id: string;
  token: string;
  preview: string;
}
export interface FormDraft {
  customer: {
    salutation: "" | "Frau" | "Herr";
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  from: AddressDraft;
  to: AddressDraft;
  dateFixed: boolean;
  movingDate: string;
  dateFrom: string;
  dateTo: string;
  costsAssumption: boolean;
  visitWanted: boolean;
  bulky: boolean;
  heavy: boolean;
  expensive: boolean;
  bulkyItems: SpecialItem[];
  heavyItems: SpecialItem[];
  expensiveItems: SpecialItem[];
  packingRequested: boolean;
  quantities: Record<string, number>;
  furniture: Record<string, number>;
  boxes: number;
  wardrobeBoxes: number;
  note: string;
  privacyAccepted: boolean;
  images: ImageDraft[];
}
export interface FormResources {
  config: CustomerFormConfig;
  categories: CatalogCategoryDto[];
  furniture: CatalogFurnitureDto[];
  packings: CatalogPackingDto[];
  services: CatalogServiceDto[];
  rates: CatalogServiceRateDto[];
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export const newSpecialItem = (): SpecialItem => ({
  id: crypto.randomUUID(),
  name: "",
  quantity: "1",
  width: "",
  depth: "",
  height: "",
  weight: "",
});
const newAddress = (): AddressDraft => ({
  street: "",
  postalCode: "",
  city: "",
  kitchenWidth: "",
  wardrobeWidth: "",
  bedNumber: "",
  roomsToRelocate: "",
  parkingSlot: false,
  demontage: false,
  montage: false,
  stockwerke: [],
});
export function initialDraft(): FormDraft {
  return {
    customer: {
      salutation: "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
    },
    from: newAddress(),
    to: newAddress(),
    dateFixed: true,
    movingDate: localDate(),
    dateFrom: localDate(),
    dateTo: localDate(),
    costsAssumption: false,
    visitWanted: false,
    bulky: false,
    heavy: false,
    expensive: false,
    bulkyItems: [newSpecialItem()],
    heavyItems: [newSpecialItem()],
    expensiveItems: [newSpecialItem()],
    packingRequested: false,
    quantities: {},
    furniture: {},
    boxes: 0,
    wardrobeBoxes: 0,
    note: "",
    privacyAccepted: false,
    images: [],
  };
}
export function suggestVisit(draft: FormDraft) {
  return draft.from.movementObject === "Haus";
}
export function validateStep(draft: FormDraft, step: number): string | null {
  const missing = (label: string) =>
    `Das Feld "${label}" ist erforderlich. Bitte tragen Sie etwas ein.`;
  if (step === 0) {
    for (const [key, label] of [
      ["firstName", "Vorname"],
      ["lastName", "Nachname"],
      ["email", "E-Mail"],
      ["phone", "Telefon"],
    ] as const) {
      if (!draft.customer[key].trim()) return missing(label);
    }
    if (!isValidEmailAddress(draft.customer.email))
      return "Die E-Mail Adresse ist ungültig";
    if (!/[0-9]{3}/.test(draft.customer.phone))
      return "Bitte geben Sie eine gültige Telefonnummer ein.";
    const dates = draft.dateFixed
      ? [draft.movingDate]
      : [draft.dateFrom, draft.dateTo];
    if (
      dates.some(
        (date) =>
          !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
          Number.isNaN(Date.parse(date)) ||
          new Date(`${date}T12:00:00`).toISOString().slice(0, 10) !== date,
      )
    )
      return "Bitte geben Sie einen gültigen Umzugstermin ein.";
    if (dates.some((date) => date < localDate()))
      return "Der Umzugstermin darf nicht in der Vergangenheit liegen.";
    if (!draft.dateFixed && draft.dateTo < draft.dateFrom)
      return "Der späteste Umzugstermin muss nach dem frühesten liegen.";
  }
  if (step === 1 || step === 2) {
    const address = step === 1 ? draft.from : draft.to;
    const fields: Array<[keyof AddressDraft, string]> = [
      ["street", "Straße und Hausnummer"],
      ["postalCode", "PLZ"],
      ["city", "Ort"],
      ["runningDistance", "Entfernung vom Parkplatz zur Haustür"],
      ["movementObject", step === 1 ? "Auszug aus" : "Einzug in"],
      ...(step === 1
        ? ([
            ["roomsNumber", "Anzahl der Zimmer"],
            ["area", "Wohnfläche"],
          ] as Array<[keyof AddressDraft, string]>)
        : []),
      ...(address.movementObject !== "Haus"
        ? ([
            ["floor", "Stockwerk"],
            ["liftType", "Fahrstuhl"],
          ] as Array<[keyof AddressDraft, string]>)
        : []),
    ];
    for (const [key, label] of fields)
      if (!String(address[key] ?? "").trim()) return missing(label);
    if (!/.{1,50}\d.{0,5}/.test(address.street))
      return "Straße und Hausnummer sind unvollständig.";
    if (
      step === 1 &&
      (!Number.isFinite(Number(address.roomsNumber)) ||
        Number(address.roomsNumber) <= 0)
    )
      return "Bitte geben Sie eine gültige Anzahl der Zimmer ein.";
    for (const key of [
      "kitchenWidth",
      "wardrobeWidth",
      "bedNumber",
      "roomsToRelocate",
    ] as const) {
      if (
        address[key] &&
        (!Number.isFinite(Number(address[key])) || Number(address[key]) < 0)
      )
        return "Bitte geben Sie eine gültige positive Zahl ein.";
    }
  }
  return null;
}

export function validationFieldLabel(
  draft: FormDraft,
  step: number,
  message: string,
): string | null {
  const requiredField = message.match(/Das Feld "([^"]+)"/);
  if (requiredField?.[1]) return requiredField[1];
  if (message.includes("E-Mail")) return "E-Mail";
  if (message.includes("Telefon")) return "Telefon";
  if (message.includes("Straße und Hausnummer")) return "Straße und Hausnummer";
  if (message.includes("Anzahl der Zimmer")) return "Anzahl der Zimmer";

  if (step === 0 && message.includes("Umzugstermin")) {
    if (message.includes("späteste")) return "spätester Umzugstermin";
    const dates = draft.dateFixed
      ? [{ value: draft.movingDate, label: "Umzugstermin" }]
      : [
          { value: draft.dateFrom, label: "frühester Umzugstermin" },
          { value: draft.dateTo, label: "spätester Umzugstermin" },
        ];
    return (
      dates.find(({ value }) =>
        message.includes("Vergangenheit")
          ? value < localDate()
          : !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
            Number.isNaN(Date.parse(value)) ||
            new Date(`${value}T12:00:00`).toISOString().slice(0, 10) !== value,
      )?.label ??
      dates[0]?.label ??
      null
    );
  }

  if (step === 1 || step === 2) {
    const address = step === 1 ? draft.from : draft.to;
    if (message.includes("positive Zahl")) {
      const numericFields = [
        ["kitchenWidth", "Küchenbreite"],
        ["wardrobeWidth", "Gesamtbreite der Schränke"],
        ["bedNumber", "Betten"],
        ["roomsToRelocate", "Anzahl der Zimmer zum Umziehen"],
      ] as const;
      return (
        numericFields.find(
          ([key]) =>
            address[key] &&
            (!Number.isFinite(Number(address[key])) ||
              Number(address[key]) < 0),
        )?.[1] ?? "Anzahl der Zimmer zum Umziehen"
      );
    }
  }

  return null;
}

export function calculateVolume(
  draft: FormDraft,
  resources: FormResources,
): number | null {
  if (
    (draft.boxes > 0 && resources.config.boxVolume === null) ||
    (draft.wardrobeBoxes > 0 && resources.config.wardrobeBoxVolume === null)
  )
    return null;
  return (
    resources.furniture.reduce(
      (sum, furniture) =>
        sum +
        resources.categories.reduce(
          (quantity, category) =>
            quantity + (draft.furniture[`${furniture.id}:${category.id}`] ?? 0),
          0,
        ) *
          furniture.volume,
      0,
    ) +
    draft.boxes * (resources.config.boxVolume ?? 0) +
    draft.wardrobeBoxes * (resources.config.wardrobeBoxVolume ?? 0)
  );
}

function cleanAddress(
  address: AddressDraft,
  departure: boolean,
): OrderAddressInput {
  const {
    kitchenWidth,
    wardrobeWidth,
    bedNumber,
    roomsToRelocate,
    floor,
    liftType,
    stockwerke,
    ...rest
  } = address;
  return {
    ...rest,
    ...(address.movementObject === "Haus"
      ? { stockwerke: stockwerke ?? [] }
      : {
          ...(floor !== undefined ? { floor } : {}),
          ...(liftType !== undefined ? { liftType } : {}),
        }),
    ...(roomsToRelocate ? { roomsToRelocate: Number(roomsToRelocate) } : {}),
    ...(departure && address.demontage
      ? {
          kitchenWidth: Number(kitchenWidth),
          wardrobeWidth: Number(wardrobeWidth),
          bedNumber: Number(bedNumber),
        }
      : {}),
  };
}
function specialText(
  items: SpecialItem[],
  dimensions: boolean,
  weight: boolean,
) {
  return items
    .filter((item) => item.name.trim())
    .map(
      (item) =>
        `${item.quantity || 1} × ${item.name}${dimensions ? ` (${item.width || 0} × ${item.depth || 0} × ${item.height || 0} cm)` : ""}${weight ? `, ${item.weight || 0} kg` : ""}`,
    )
    .join("\n");
}
export function createPayload(
  draft: FormDraft,
  resources: FormResources,
): CreateOrderInput {
  return {
    customer: draft.customer,
    from: cleanAddress(draft.from, true),
    to: cleanAddress(draft.to, false),
    dateFixed: draft.dateFixed,
    movingDate: draft.dateFixed ? draft.movingDate : draft.dateFrom,
    ...(!draft.dateFixed
      ? { dateFrom: draft.dateFrom, dateTo: draft.dateTo }
      : {}),
    costsAssumption: draft.costsAssumption,
    visitWanted: suggestVisit(draft) && draft.visitWanted,
    privacyAccepted: draft.privacyAccepted,
    note: draft.note,
    imageClaims: draft.images.map(({ id, token }) => ({ id, token })),
    details: {
      showSecondaryFrom: false,
      showSecondaryTo: false,
      distanceKm: 0,
      furniture: {
        volume: calculateVolume(draft, resources) ?? 0,
        volumeComplete: calculateVolume(draft, resources) !== null,
        boxes: draft.boxes,
        wardrobeBoxes: draft.wardrobeBoxes,
        ownItems: "",
        items: resources.categories.flatMap((category) =>
          resources.furniture.flatMap((item) => {
            const quantity = draft.furniture[`${item.id}:${category.id}`] ?? 0;
            return quantity > 0 && item.categoryIds.includes(category.id)
              ? [
                  {
                    catalogId: item.id,
                    name: item.name,
                    category: category.name,
                    quantity,
                    volume: item.volume,
                  },
                ]
              : [];
          }),
        ),
        bulky: draft.bulky,
        heavy: draft.heavy,
        expensive: draft.expensive,
        bulkyText: draft.bulky
          ? specialText(draft.bulkyItems, true, false)
          : "",
        heavyText: draft.heavy ? specialText(draft.heavyItems, true, true) : "",
        expensiveText: draft.expensive
          ? specialText(draft.expensiveItems, false, false)
          : "",
      },
      extras: {
        packingRequested: draft.packingRequested,
        services: [
          ...resources.services.flatMap((item) =>
            (draft.quantities[`service:${item.id}`] ?? 0) > 0
              ? [
                  {
                    catalogId: item.id,
                    name: item.name,
                    kind: "service" as const,
                    quantity: draft.quantities[`service:${item.id}`]!,
                  },
                ]
              : [],
          ),
          ...(draft.packingRequested
            ? resources.packings.flatMap((item) =>
                (draft.quantities[`packaging:${item.id}`] ?? 0) > 0
                  ? [
                      {
                        catalogId: item.id,
                        name: item.name,
                        kind: "packaging" as const,
                        quantity: draft.quantities[`packaging:${item.id}`]!,
                      },
                    ]
                  : [],
              )
            : []),
        ],
      },
      basis: {
        workers: 0,
        trucks: 0,
        hours: 0,
        basePrice: 0,
        extraHourPrice: 0,
        discountPercent: 0,
      },
      conditions: [],
    },
  };
}
