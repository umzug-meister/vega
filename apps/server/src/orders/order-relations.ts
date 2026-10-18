import { randomUUID } from "node:crypto";
import type {
  OrderAddress,
  OrderAddressRole,
  OrderPosition,
  Prisma,
} from "../generated/prisma/client.js";
import type {
  CreateOrderInput,
  OrderAddressInput,
  OrderFurnitureInput,
  OrderServiceInput,
} from "@vega/domain";
import { validateOrderCreateInput } from "./order-input.js";

export const orderRelations = {
  addresses: true,
  positions: { orderBy: { position: "asc" } },
} satisfies Prisma.OrderInclude;

export function orderRelationCreates(input: CreateOrderInput) {
  const addresses: Array<{
    role: OrderAddressRole;
    address: OrderAddressInput;
  }> = [
    { role: "FROM", address: input.from },
    { role: "TO", address: input.to },
  ];
  if (input.details?.secondaryFrom)
    addresses.push({
      role: "SECONDARY_FROM",
      address: input.details.secondaryFrom,
    });
  if (input.details?.secondaryTo)
    addresses.push({
      role: "SECONDARY_TO",
      address: input.details.secondaryTo,
    });
  const addressRows = addresses.map(({ role, address }) => {
    const { street, postalCode, city, ...details } = address;
    return {
      id: randomUUID(),
      role,
      street,
      postalCode,
      city,
      details: JSON.parse(JSON.stringify(details)) as Prisma.InputJsonValue,
    };
  });
  const positions: Prisma.OrderPositionCreateWithoutOrderInput[] = [
    ...(input.details?.furniture.items ?? []).map((item, position) => ({
      id: randomUUID(),
      kind: "FURNITURE" as const,
      position,
      ...item,
    })),
    ...(input.details?.extras.services ?? []).map(
      ({ kind, unitPrice: _unitPrice, ...item }, position) => ({
        id: randomUUID(),
        kind:
          kind === "packaging" ? ("PACKAGING" as const) : ("SERVICE" as const),
        position,
        ...item,
      }),
    ),
  ];
  return {
    addresses: { create: addressRows },
    positions: { create: positions },
  };
}

export function orderDataWithRelations(order: {
  data: Prisma.JsonValue;
  addresses: OrderAddress[];
  positions: OrderPosition[];
}): CreateOrderInput {
  const validation = validateOrderCreateInput(order.data, {
    allowStaffPricing: true,
    allowIncomplete: true,
  });
  if (!validation.ok) throw new Error("INVALID_STORED_ORDER");
  const input = validation.value;
  const address = (role: OrderAddressRole): OrderAddressInput | undefined => {
    const row = order.addresses.find((entry) => entry.role === role);
    if (!row) return undefined;
    if (
      typeof row.details !== "object" ||
      row.details === null ||
      Array.isArray(row.details)
    )
      throw new Error("INVALID_STORED_ADDRESS");
    return {
      ...row.details,
      street: row.street,
      postalCode: row.postalCode,
      city: row.city,
    };
  };
  const from = address("FROM");
  const to = address("TO");
  if (!from || !to) throw new Error("MISSING_ORDER_ADDRESSES");
  const items: OrderFurnitureInput[] = [];
  const services: OrderServiceInput[] = [];
  for (const row of [...order.positions].sort(
    (left, right) => left.position - right.position,
  )) {
    const item = {
      name: row.name,
      quantity: row.quantity,
      ...(row.catalogId === null ? {} : { catalogId: row.catalogId }),
    };
    if (row.kind === "FURNITURE")
      items.push({
        ...item,
        ...(row.volume === null ? {} : { volume: row.volume }),
        ...(row.category === null ? {} : { category: row.category }),
      });
    else
      services.push({
        ...item,
        kind: row.kind === "PACKAGING" ? "packaging" : "service",
      });
  }
  const secondaryFrom = address("SECONDARY_FROM");
  const secondaryTo = address("SECONDARY_TO");
  let details: CreateOrderInput["details"];
  if (input.details) {
    const {
      secondaryFrom: _snapshotFrom,
      secondaryTo: _snapshotTo,
      ...snapshotDetails
    } = input.details;
    details = {
      ...snapshotDetails,
      ...(secondaryFrom ? { secondaryFrom } : {}),
      ...(secondaryTo ? { secondaryTo } : {}),
      furniture: { ...snapshotDetails.furniture, items },
      extras: { ...snapshotDetails.extras, services },
    };
  }
  const result: CreateOrderInput = {
    ...input,
    from,
    to,
    ...(details ? { details } : {}),
  };
  const checked = validateOrderCreateInput(result, {
    allowStaffPricing: true,
    allowIncomplete: true,
  });
  if (!checked.ok) throw new Error("INVALID_STORED_ORDER_RELATIONS");
  return checked.value;
}
