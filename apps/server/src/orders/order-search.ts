import type { Prisma } from "../generated/prisma/client.js";

export const ORDER_NUMBER_MAX = 2_147_483_647;
const SEARCH_MAX_LENGTH = 100;

export type OrderSearchKind = "none" | "text" | "orderNumber";

/**
 * Normalizes the admin order search input. Numeric input outside the `Int`
 * range of `Order.orderNumber` must stay a text search; passing it on would
 * make Prisma reject the whole query.
 */
export function normalizeOrderSearch(value: unknown): {
  search: string;
  kind: OrderSearchKind;
  orderNumber: number | null;
} {
  const search =
    typeof value === "string"
      ? value.trim().slice(0, SEARCH_MAX_LENGTH)
      : "";
  const orderNumber = parseOrderNumber(search);
  return {
    search,
    kind: !search ? "none" : orderNumber === null ? "text" : "orderNumber",
    orderNumber,
  };
}

/** Query for the admin order list, including only safe order-number matches. */
export function orderListWhere(input: {
  archived: boolean;
  search: string;
  orderNumber: number | null;
}): Prisma.OrderWhereInput {
  return {
    archivedAt: input.archived ? { not: null } : null,
    ...(input.search
      ? {
          OR: [
            { customerName: { contains: input.search } },
            { customerEmail: { contains: input.search } },
            ...(input.orderNumber === null
              ? []
              : [{ orderNumber: input.orderNumber }]),
          ],
        }
      : {}),
  };
}

function parseOrderNumber(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= ORDER_NUMBER_MAX
    ? parsed
    : null;
}
