export {
  meetsPasswordPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "./password-policy.js";
export {
  manualInvoiceNextValue,
  MAX_INVOICE_SEQUENCE_VALUE,
} from "./invoice-number.js";
export { isValidEmailAddress } from "./email.js";
export type {
  SetupVariableDto,
  SetupInfoDto,
  SetupCheckDto,
  SetupSmokeTestDto,
} from "./setup.js";
export { calculateOrderPricing, OrderPricingError } from "./order-pricing.js";
export type {
  CalculateOrderPricingInput,
  PricedOrderService,
} from "./order-pricing.js";

/** Anwendungsrollen; Berechtigungen werden serverseitig durchgesetzt. */
export type UserRole = "Admin" | "Kundenberater";

/** TOTP is mandatory for admins; Kundenberater may enable or disable it themselves. */
export function isTotpRequired(role: string): boolean {
  return role !== "Kundenberater";
}

/** Whether an account still has to finish TOTP enrollment before staff access. */
export function needsTotpSetup(user: {
  role: string;
  twoFactorEnabled?: boolean | null | undefined;
}): boolean {
  return isTotpRequired(user.role) && user.twoFactorEnabled !== true;
}

export interface StaffAccountDto {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  blocked: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean | null;
  createdAt: string;
}

/** Minimaler öffentlicher Statusvertrag des Express-Healthchecks. */
export interface HealthStatus {
  status: "ok";
  service: "vega";
}

export interface OrderAddressInput {
  street: string;
  postalCode: string;
  city: string;
  floor?: string;
  runningDistance?: string;
  parkingSlot?: boolean;
  movementObject?: "Wohnung" | "Haus" | "Keller" | "Lager" | "Büro";
  liftType?: string;
  isAltbau?: boolean;
  hasLoft?: boolean;
  hasBasement?: boolean;
  hasGarage?: boolean;
  area?: string;
  roomsNumber?: string;
  roomsToRelocate?: number;
  packservice?: boolean;
  demontage?: boolean;
  montage?: boolean;
  stockwerke?: string[];
  kitchenWidth?: number;
  wardrobeWidth?: number;
  bedNumber?: number;
  bulky?: boolean;
}

export interface OrderFurnitureInput {
  name: string;
  quantity: number;
  volume?: number;
  category?: string;
  catalogId?: number;
}

export interface OrderServiceInput {
  name: string;
  quantity: number;
  kind: "packaging" | "service";
  catalogId?: number;
  unitPrice?: number;
}

export interface OrderConditionInput {
  description: string;
  amount: number;
  quantity?: number;
  unitPrice?: number;
  kind?:
    | "manual"
    | "base"
    | "discount"
    | "travel"
    | "parking"
    | "services"
    | "packaging";
}

export interface OrderRouteLegInput {
  distanceKm: number;
  durationMinutes: number;
}

export interface OrderRouteSnapshotInput {
  calculatedAt: string;
  origin: string;
  addresses: string[];
  distanceKm: number;
  durationMinutes: number;
  legs: OrderRouteLegInput[];
}

export interface OrderPricingSnapshot {
  version: 1;
  calculatedAt: string;
  source: {
    offerId: number | null;
    workers: number;
    trucks: number;
    hours: number;
    basePrice: number;
    extraHourPrice: number;
    discountPercent: number;
    distanceKm: number;
    distanceSource?: "manual" | "route";
    addresses: Array<{ city: string; parkingSlot: boolean }>;
    services: Array<{
      kind: "service" | "packaging";
      catalogId: number | null;
      quantity: number;
      unitPrice?: number | null;
    }>;
  };
  offer: CatalogOfferDto | null;
  rates: CatalogServiceRateDto[];
  services: Array<{
    id: number;
    kind: "service" | "packaging";
    name: string;
    price: number;
    sort: number;
  }>;
}

export interface OrderDetailsInput {
  secondaryFrom?: OrderAddressInput;
  secondaryTo?: OrderAddressInput;
  showSecondaryFrom: boolean;
  showSecondaryTo: boolean;
  distanceKm: number;
  distanceSource?: "manual" | "route";
  routeSnapshot?: OrderRouteSnapshotInput;
  furniture: {
    volume: number;
    volumeComplete?: boolean;
    boxes: number;
    wardrobeBoxes: number;
    ownItems: string;
    items: OrderFurnitureInput[];
    expensive: boolean;
    expensiveText: string;
    heavy: boolean;
    heavyText: string;
    bulky: boolean;
    bulkyText: string;
  };
  extras: {
    packingRequested: boolean;
    services: OrderServiceInput[];
  };
  basis: {
    workers: number;
    trucks: number;
    hours: number;
    basePrice: number;
    extraHourPrice: number;
    discountPercent: number;
    offerId?: number;
  };
  conditions: OrderConditionInput[];
}

/** Public and staff order input; staff prices are validated and previews are calculated server-side. */
export interface CreateOrderInput {
  privacyAccepted?: boolean;
  visitWanted?: boolean;
  imageClaims?: Array<{ id: string; token: string }>;
  customer: {
    company?: string;
    salutation?: "Herr" | "Frau" | "Divers" | "";
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
  };
  from: OrderAddressInput;
  to: OrderAddressInput;
  details?: OrderDetailsInput;
  pricingSnapshot?: OrderPricingSnapshot;
  movingDate: string;
  movingTime?: string;
  dateFrom?: string;
  dateTo?: string;
  dateFixed?: boolean;
  orderSource?:
    | "express"
    | "individuelle"
    | "Moebelliste"
    | "UmzugRuckZuck"
    | "check24"
    | "umzugruckzuck24.de";
  note?: string;
  costsAssumption?: boolean;
}

export interface OrderPricingPreview {
  conditions: OrderConditionInput[];
  pricingSnapshot: OrderPricingSnapshot;
}

export interface CreateOrderResult {
  orderNumber: number;
}

export interface CustomerFormConfig {
  privacyUrl: string | null;
  boxCalculatorUrl: string | null;
  successUrl: string | null;
  boxVolume: number | null;
  wardrobeBoxVolume: number | null;
  uploadsAvailable: boolean;
  placesAvailable: boolean;
}

export interface AppSettingsDto {
  revision: number;
  boxCbm: number | null;
  kleiderboxCbm: number | null;
  origin: string | null;
  dataPrivacyUrl: string | null;
  successUrl: string | null;
  boxCalculatorUrl: string | null;
  companyEmail: string | null;
  emailFromName: string | null;
  emailFromAddress: string | null;
}
export type AppSettingsInput = Omit<AppSettingsDto, "revision">;

/** Staff-only order representation. Never expose this DTO from public routes. */
export interface AdminOrderListItem {
  orderNumber: number;
  source: string;
  customerName: string;
  movingDate: string;
  fromAddress: string;
  fromParkingSlot: boolean;
  toAddress: string;
  toParkingSlot: boolean;
  workers: number | null;
  trucks: number | null;
  hours: number | null;
  createdAt: string;
  editedAt: string | null;
  isCopy: boolean;
  archivedAt: string | null;
}

export interface AdminOrderDetail extends AdminOrderListItem {
  revision: number;
  data: CreateOrderInput;
  originOrderId: string | null;
}

/** One order of a copy family (root plus all copies). */
export interface AdminOrderFamilyMember {
  orderNumber: number;
  isOrigin: boolean;
  archived: boolean;
  movingDate: string;
  workers: number | null;
  trucks: number | null;
}

export type OrderEmailKind = "offer" | "offer-pair" | "decline";

/** Editable, server-generated mail draft; attachments are rendered at send time. */
export interface EmailDraft {
  to: string;
  subject: string;
  contentHtml: string;
  attachmentNames: string[];
}

export interface StaffEmailSendInput {
  to: string;
  subject: string;
  contentHtml: string;
  idempotencyKey: string;
}

export interface OrderEmailSendInput extends StaffEmailSendInput {
  kind: OrderEmailKind;
  partnerOrderNumber?: number;
}

export type StaffEmailSendResult =
  | { status: "NOT_QUEUED"; outboxId?: string }
  | { status: "SENT"; outboxId?: string }
  | { status: "SENDING"; outboxId?: string }
  | { status: "UNKNOWN"; errorCode: string; outboxId?: string }
  | { status: "FAILED"; errorCode: string; outboxId?: string }
  | { status: "RETRY_SCHEDULED"; errorCode: string; outboxId?: string };

/** Minimal audit projection; deliberately excludes field-level before/after values. */
export interface AdminOrderJournalEntry {
  id: string;
  action: string;
  actorName: string;
  occurredAt: string;
}

export interface InvoiceEntryInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface InvoiceDueDateInput {
  date: string;
  amount: number;
  text: string;
}

export interface InvoiceInput {
  invoiceNumber?: string;
  invoiceDate: string;
  company: string;
  customerName: string;
  customerStreet: string;
  customerPostalCity: string;
  taxPercent: number;
  text: string;
  entries: InvoiceEntryInput[];
  dueDates: InvoiceDueDateInput[];
}

export interface AdminInvoiceDto extends InvoiceInput {
  id: string;
  revision: number;
  invoiceNumber: string;
  orderNumber: number | null;
  orderOverview?: AdminInvoiceOrderOverview;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Read-only order summary included when preparing an invoice from an order. */
export interface AdminInvoiceOrderOverview {
  orderNumber: number;
  movingDate: string;
  conditions: OrderConditionInput[];
}

export interface AdminInvoiceListDto {
  items: AdminInvoiceDto[];
  total: number;
  page: number;
  pageSize: number;
}

export {
  addInvoiceAmounts,
  calculateInvoiceTotals,
  calculateRoundedPercent,
  calculateRoundedSubtotal,
  invoiceLineTotal,
  roundAmountToCents,
  roundAmountToNearestIncrement,
  roundProductToNearestIncrement,
  roundInvoiceAmount,
} from "./invoice-calculation.js";
export {
  MAX_INVOICE_AMOUNT,
  isInvoiceAmount,
  isInvoiceDate,
  validateInvoiceEntries,
} from "./invoice-validation.js";

/** Legacy accounting tabs: at most three consecutive payment reminders per invoice. */
export const MAX_REMINDER_LEVEL = 3;

export interface CreditNoteInput {
  creditNumber: string;
  creditDate: string;
  text: string;
  entries: InvoiceEntryInput[];
}

export interface AdminCreditNoteDto extends CreditNoteInput {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string;
  company: string;
  customerName: string;
  customerStreet: string;
  customerPostalCity: string;
  taxPercent: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReminderInput {
  dueDate: string;
  fee: number;
  outstandingAmount: number;
  text: string;
}

export interface AdminReminderDto extends ReminderInput {
  id: string;
  invoiceId: string | null;
  invoiceNumber: string;
  level: number;
  /** Invoice due date for level 1, otherwise the due date of the previous reminder. */
  previousDueDate: string;
  sentAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Legacy defaults: each reminder is due 10 days after the previous due date and costs 10 EUR. */
export const REMINDER_WAITING_DAYS = 10;
export const DEFAULT_REMINDER_FEE = 10;

/** Adds days to an ISO date (`YYYY-MM-DD`) in UTC. */
export function addIsoDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Formats an ISO date as `TT.MM.JJJJ` like the legacy accounting documents. */
export function formatGermanDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

/** Legacy "Verzug": inclusive day count from the previous due date to the reminder due date. */
export function reminderDelayDays(
  previousDueDate: string,
  dueDate: string,
): number {
  const days = Math.round(
    (Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${previousDueDate.slice(0, 10)}T00:00:00Z`)) /
      86400000,
  );
  return Math.max(0, days + 1);
}

export function reminderGreeting(input: {
  company: string;
  salutation?: string | undefined;
  lastName?: string | undefined;
}): string {
  const lastName = input.lastName?.trim();
  if (input.company.trim() || !lastName)
    return "Sehr geehrte Damen und Herren,";
  if (input.salutation === "Frau") return `Sehr geehrte Frau ${lastName},`;
  if (input.salutation === "Herr") return `Sehr geehrter Herr ${lastName},`;
  return "Sehr geehrte Damen und Herren,";
}

/**
 * Ports the legacy reminder texts. `dueDates[0]` is the invoice due date,
 * `dueDates[n]` the due date of reminder n; the last entry is the new deadline.
 */
export function reminderText(input: {
  level: number;
  greeting: string;
  outstandingAmount: number;
  dueDates: string[];
}): string {
  const date = (index: number) => formatGermanDate(input.dueDates[index] ?? "");
  const next = date(input.level);
  const euro = new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(input.outstandingAmount);
  const notice =
    "Sofern Sie zwischenzeitlich die Zahlung veranlasst haben, bitten wir Sie, dieses Schreiben als gegenstandslos zu betrachten.";
  const body =
    input.level === 1
      ? `gewiss ist es Ihnen entgangen, dass ein Betrag in Höhe von ${euro} bereits am ${date(0)} fällig war. Zur Vermeidung der Erhebung von Verzugszinsen bitten wir Sie, Ihre Zahlung bis zum ${next} vorzunehmen.\n\nSollten Sie den Ausgleich bereits veranlasst haben, sehen Sie dieses Schreiben bitte als gegenstandslos an.`
      : input.level === 2
        ? `auf unsere Mahnung vom ${date(1)} haben Sie leider nicht reagiert. Bitte überweisen Sie den fälligen Betrag bis zum ${next}.\n\nFalls Sie diesen Zahlungstermin nicht einhalten, werden wir Ihnen Kosten des Mahnverfahrens und Verzugszinsen in Rechnung stellen müssen.\n\n${notice}`
        : `auf unsere Mahnung vom ${date(1)} und 2. Mahnung vom ${date(2)} haben Sie nicht reagiert. Bitte überweisen Sie den fälligen Betrag bis spätestens ${next}. Falls die letzte Zahlungsfrist ohne Eingang des Betrages auf unser Konto verstreicht, sehen wir uns gezwungen, gerichtliche Schritte gegen Sie einleiten zu müssen. Die Kosten des gesamten Verfahrens gehen zu Ihren Lasten.\n\n${notice}`;
  return `${input.greeting}\n\n${body}\n\nMit freundlichen Grüßen\nAlexander Berent`;
}

export interface CatalogCategoryDto {
  id: number;
  name: string;
  sort: number;
}

export interface CatalogFurnitureDto {
  id: number;
  name: string;
  categoryIds: number[];
  categoryRefs: Array<Pick<CatalogCategoryDto, "id" | "name">>;
  volume: number;
  step: number;
  sortOrder: number;
}

export interface CatalogServiceDto {
  id: number;
  name: string;
  price: number;
  sort: number;
  show: boolean;
}

export interface CatalogPackingDto {
  id: number;
  name: string;
  price: number;
  description: string;
  media: string | null;
  sort: number;
  show: boolean;
}

export interface CatalogOfferDto {
  id: number;
  name: string;
  workers: number;
  trucks: number;
  includedHours: number;
  sum: number;
  hourPrice: number;
  ridingCosts: number;
  sort: number;
}

export const SERVICE_RATE_KEYS = [
  "aBettDeMon",
  "aBoxPack",
  "acbm",
  "aetage",
  "akitmon",
  "ameter",
  "awardmon",
  "disposalBasicPrice",
  "disposalCbmPrice",
  "kmPrice",
  "hvzPrice",
  "ridingCostsTruck1",
  "ridingCostsTruck2",
  "ridingCostsTruck3",
  "ridingCostsTruck4",
] as const;

export type ServiceRateKey = (typeof SERVICE_RATE_KEYS)[number];

/**
 * Highest truck count with a dedicated riding-cost rate. Travel costs are only
 * defined for these counts, so offers and order bases must not exceed it.
 */
export const MAX_TRUCKS = SERVICE_RATE_KEYS.filter((key) =>
  key.startsWith("ridingCostsTruck"),
).length;

export interface CatalogServiceRateDto {
  key: ServiceRateKey;
  price: number;
}

export type CatalogCategoryInput = Pick<CatalogCategoryDto, "name" | "sort">;

export type CatalogFurnitureInput = Omit<
  CatalogFurnitureDto,
  "id" | "categoryRefs"
>;

export type CatalogServiceInput = Omit<CatalogServiceDto, "id">;

export type CatalogPackingInput = Omit<CatalogPackingDto, "id">;

export type CatalogOfferInput = Omit<CatalogOfferDto, "id">;
