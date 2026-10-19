import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import test, { type TestContext } from "node:test";
import type { AppSettingsDto, CreateOrderInput } from "@vega/domain";
import type { Prisma } from "../src/generated/prisma/client.js";
import {
  OrderInputError,
  validateOrderCreateInput,
} from "../src/orders/order-input.js";
import {
  orderDataWithRelations,
  orderRelationCreates,
  orderRelations,
} from "../src/orders/order-relations.js";
import { orderFixture } from "./fixtures/order.js";

const unexpected = async (_input?: unknown): Promise<never> => {
  throw new Error("Unexpected database operation");
};
const client = {
  catalogFurniture: {
    findMany: async (_input: unknown): Promise<unknown[]> => [],
  },
  catalogService: {
    findMany: async (_input: unknown): Promise<unknown[]> => [],
  },
  catalogPacking: {
    findMany: async (_input: unknown): Promise<unknown[]> => [],
  },
  order: { count: unexpected, findMany: unexpected, findUnique: unexpected },
  $transaction: unexpected,
};
const previous = Reflect.get(globalThis, "vegaPrisma");
Reflect.set(globalThis, "vegaPrisma", client);
const { createOrder, normalizeOrderCatalogInput, roundChangedOrderConditions } =
  await import("../src/orders/order-service.js");
const { createAdminOrderRouter } =
  await import("../src/orders/admin-order-routes.js");
if (previous === undefined) Reflect.deleteProperty(globalThis, "vegaPrisma");
else Reflect.set(globalThis, "vegaPrisma", previous);

type StoredOrder = Prisma.OrderGetPayload<{ include: typeof orderRelations }>;
function storedOrder(input = orderFixture(), revision = 0): StoredOrder {
  const relations = orderRelationCreates(input);
  return {
    id: "order-test",
    orderNumber: 1000,
    revision,
    customerName: `${input.customer.firstName} ${input.customer.lastName}`,
    customerEmail: input.customer.email ?? null,
    customerPhone: input.customer.phone,
    source: "individuelle",
    data: JSON.parse(JSON.stringify(input)),
    createdAt: new Date("2026-10-01T09:00:00Z"),
    updatedAt: new Date("2026-10-02T09:00:00Z"),
    edited: false,
    archivedAt: null,
    purgeAt: null,
    originOrderId: null,
    addresses: relations.addresses.create.map((address) => ({
      ...address,
      orderId: "order-test",
    })),
    positions: relations.positions.create.map((position) => ({
      volume: null,
      category: null,
      catalogId: null,
      ...position,
      orderId: "order-test",
    })),
  } as StoredOrder;
}

async function serve(context: TestContext, transaction: object) {
  context.mock.method(
    client,
    "$transaction",
    async (operation: (tx: object) => Promise<unknown>) =>
      operation(transaction),
  );
  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.staffUser = { id: "staff-test", name: "Test Admin" };
    next();
  });
  app.use("/orders", createAdminOrderRouter());
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return (method: string, body?: unknown, suffix = "") =>
    fetch(`http://127.0.0.1:${address.port}/orders/1000${suffix}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

function publicFixture() {
  const input = orderFixture();
  input.customer.email = "";
  input.details!.basis = {
    workers: 0,
    trucks: 0,
    hours: 0,
    basePrice: 0,
    extraHourPrice: 0,
    discountPercent: 0,
  };
  input.details!.furniture = {
    ...input.details!.furniture,
    items: [],
    boxes: 0,
    wardrobeBoxes: 0,
    volume: 0,
  };
  return input;
}
const settings: AppSettingsDto = {
  revision: 0,
  boxCbm: 1,
  kleiderboxCbm: 1,
  origin: null,
  dataPrivacyUrl: null,
  successUrl: null,
  boxCalculatorUrl: null,
  companyEmail: null,
  emailFromName: null,
  emailFromAddress: null,
};

for (const kind of ["furniture", "boxes"] as const) {
  for (const aboveLimit of [false, true]) {
    test(`public ${kind} normalized volume ${aboveLimit ? "above" : "at"} the limit is checked before writing`, async (context) => {
      const input = publicFixture();
      if (kind === "furniture") {
        input.details!.furniture.items = [
          {
            catalogId: 1,
            name: "Untrusted",
            volume: 0,
            quantity: aboveLimit ? 1.00001 : 1,
          },
        ];
        context.mock.method(client.catalogFurniture, "findMany", async () => [
          { id: 1, name: "Catalog sofa", volume: 100_000, categories: [] },
        ]);
      } else {
        input.details!.furniture.boxes = 100_000;
        input.details!.furniture.wardrobeBoxes = aboveLimit ? 1 : 0;
      }
      assert.equal(validateOrderCreateInput(input).ok, true);
      let writes = 0;
      let savedInput: CreateOrderInput | undefined;
      context.mock.method(
        client,
        "$transaction",
        async (operation: (tx: object) => Promise<unknown>) =>
          operation({
            orderNumberSequence: {
              update: async () => {
                writes++;
                return { nextValue: 1001 };
              },
            },
            order: {
              create: async (args: { data: { data: CreateOrderInput } }) => {
                writes++;
                savedInput = args.data.data;
                return { id: "order-test" };
              },
            },
            orderActivityEvent: {
              create: async () => {
                writes++;
              },
            },
          }),
      );
      if (aboveLimit) {
        await assert.rejects(
          createOrder(input, "public", "-", settings),
          OrderInputError,
        );
        assert.equal(writes, 0);
      } else {
        assert.equal(
          (await createOrder(input, "public", "-", settings)).orderNumber,
          1000,
        );
        assert.equal(savedInput?.details?.furniture.volume, 100_000);
        assert.equal(validateOrderCreateInput(savedInput).ok, true);
        assert.equal(writes, 3);
      }
    });
  }
}

for (const state of ["deleted", "hidden", "renamed"] as const) {
  test(`staff keeps ${state} furniture, service and packing snapshots on an unrelated edit`, async (context) => {
    const input = orderFixture();
    input.details!.furniture.items[0]!.catalogId = 1;
    input.details!.extras.services[0]!.catalogId = 2;
    input.details!.extras.services[1]!.catalogId = 3;
    const stored = structuredClone(input);
    input.note = "Only a note changed";
    for (const delegate of [
      client.catalogFurniture,
      client.catalogService,
      client.catalogPacking,
    ]) {
      context.mock.method(delegate, "findMany", async () => {
        assert.fail(
          `An unchanged ${state} snapshot must not be revalidated against today's catalog`,
        );
      });
    }
    const normalized = await normalizeOrderCatalogInput(input, stored);
    assert.deepEqual(normalized.details, stored.details);
    assert.equal(normalized.note, input.note);
  });
}

test("quantity edits preserve historical snapshots but still enforce aggregate volume and quantity bounds", async (context) => {
  const stored = orderFixture();
  stored.details!.furniture.items = [
    {
      catalogId: 77,
      name: "Historical sofa",
      volume: 2,
      category: "Historical",
      quantity: 1,
    },
  ];
  context.mock.method(client.catalogFurniture, "findMany", async () => {
    assert.fail("Historical catalog row must not be required");
  });
  const changed = structuredClone(stored);
  changed.details!.furniture.items[0]!.quantity = 50_000;
  const normalized = await normalizeOrderCatalogInput(changed, stored);
  assert.deepEqual(normalized.details!.furniture.items[0], {
    ...stored.details!.furniture.items[0],
    quantity: 50_000,
  });
  changed.details!.furniture.items[0]!.quantity = 50_001;
  await assert.rejects(
    normalizeOrderCatalogInput(changed, stored),
    OrderInputError,
  );
  changed.details!.furniture.items[0]!.quantity = 100_001;
  await assert.rejects(
    normalizeOrderCatalogInput(changed, stored),
    OrderInputError,
  );
});

test("staff can change the saved unit price of a historical catalog extra without reloading its catalog row", async (context) => {
  const stored = orderFixture();
  stored.details!.extras.services[0] = {
    catalogId: 77,
    name: "Historical service",
    kind: "service",
    quantity: 1,
    unitPrice: 10,
  };
  const changed = structuredClone(stored);
  changed.details!.extras.services[0]!.unitPrice = 15;
  context.mock.method(client.catalogService, "findMany", async () => {
    assert.fail(
      "A saved catalog snapshot must not require today's catalog row to change its price",
    );
  });

  const normalized = await normalizeOrderCatalogInput(changed, stored);
  assert.equal(normalized.details!.extras.services[0]!.unitPrice, 15);
});

for (const kind of ["furniture", "service", "packaging"] as const) {
  test(`a new or forged historical ${kind} reference is rejected, including duplicate snapshot reuse`, async () => {
    const stored = orderFixture();
    if (kind === "furniture")
      stored.details!.furniture.items = [
        { catalogId: 88, name: "Old", volume: 2, quantity: 1 },
      ];
    else
      stored.details!.extras.services = [
        { catalogId: 88, kind, name: "Old", quantity: 1 },
      ];
    const forged = structuredClone(stored);
    const items =
      kind === "furniture"
        ? forged.details!.furniture.items
        : forged.details!.extras.services;
    items[0]!.name = "Forged snapshot";
    await assert.rejects(
      normalizeOrderCatalogInput(forged, stored),
      /INVALID_ORDER_CATALOG_REFERENCE/u,
    );
    items[0]!.name = "Old";
    if (kind === "furniture")
      forged.details!.furniture.items.push({
        ...forged.details!.furniture.items[0]!,
      });
    else
      forged.details!.extras.services.push({
        ...forged.details!.extras.services[0]!,
      });
    await assert.rejects(
      normalizeOrderCatalogInput(forged, stored),
      /INVALID_ORDER_CATALOG_REFERENCE/u,
    );
    items.pop();
    items[0]!.catalogId = 999;
    await assert.rejects(
      normalizeOrderCatalogInput(forged, stored),
      /INVALID_ORDER_CATALOG_REFERENCE/u,
    );
  });
}

test("new references use current visible catalog data while historical snapshots stay unchanged", async (context) => {
  const stored = orderFixture();
  stored.details!.furniture.items = [
    { catalogId: 1, name: "Original", quantity: 1, volume: 2, category: "Old" },
  ];
  stored.details!.extras.services = [
    { catalogId: 2, name: "Original service", kind: "service", quantity: 1 },
  ];
  const input = structuredClone(stored);
  input.details!.furniture.items.push({
    catalogId: 3,
    name: "Forged",
    quantity: 2,
    volume: 0,
    category: "Forged",
  });
  input.details!.extras.services.push({
    catalogId: 4,
    name: "Forged",
    kind: "packaging",
    quantity: 2,
  });
  context.mock.method(
    client.catalogFurniture,
    "findMany",
    async (query: unknown) => {
      assert.deepEqual(query, {
        where: { id: { in: [3] } },
        include: {
          categories: { include: { category: { select: { name: true } } } },
        },
      });
      return [
        {
          id: 3,
          name: "Current",
          volume: 3,
          categories: [{ category: { name: "Current category" } }],
        },
      ];
    },
  );
  context.mock.method(
    client.catalogService,
    "findMany",
    async (query: unknown) => {
      assert.deepEqual(query, {
        where: { id: { in: [4] }, show: true },
        select: { id: true, name: true },
      });
      return [];
    },
  );
  context.mock.method(client.catalogPacking, "findMany", async () => [
    { id: 4, name: "Current packing" },
  ]);
  const normalized = await normalizeOrderCatalogInput(input, stored);
  assert.deepEqual(normalized.details!.furniture.items, [
    stored.details!.furniture.items[0],
    {
      catalogId: 3,
      name: "Current",
      quantity: 2,
      volume: 3,
      category: "Current category",
    },
  ]);
  assert.deepEqual(normalized.details!.extras.services, [
    stored.details!.extras.services[0],
    { catalogId: 4, name: "Current packing", kind: "packaging", quantity: 2 },
  ]);
});

test("public creation never treats submitted snapshots as historical", async () => {
  const input = publicFixture();
  input.details!.furniture.items = [
    { catalogId: 123, name: "Historical", volume: 2, quantity: 1 },
  ];
  await assert.rejects(
    createOrder(input, "public"),
    /INVALID_ORDER_CATALOG_REFERENCE/u,
  );
});

test("new and edited order conditions round to cents while untouched historical amounts remain unchanged", () => {
  const previous = orderFixture();
  previous.details!.conditions = [{ description: "Historical", amount: 1.005 }];
  const input = structuredClone(previous);
  input.details!.conditions = [
    { description: "Historical", amount: 1.005 },
    { description: "New", amount: 2.345 },
  ];
  assert.deepEqual(
    roundChangedOrderConditions(input, previous).details!.conditions,
    [
      { description: "Historical", amount: 1.005 },
      { description: "New", amount: 2.35 },
    ],
  );
  assert.equal(
    roundChangedOrderConditions(input).details!.conditions[0]!.amount,
    1.01,
  );
});

for (const revision of [undefined, null, "0", -1, 0.5, 2_147_483_647]) {
  test(`order save rejects missing/invalid revision ${String(revision)} without database work`, async (context) => {
    const request = await serve(context, {});
    const transaction = context.mock.method(client, "$transaction", unexpected);
    const response = await request("PUT", { ...orderFixture(), revision });
    assert.equal(response.status, 400);
    assert.equal(transaction.mock.calls.length, 0);
  });
}

test("order detail exposes revision and sequential saves require the returned revision", async (context) => {
  let stored = storedOrder(orderFixture(), 7);
  const writes: string[] = [];
  const transaction = {
    order: {
      findUnique: async () => stored,
      updateMany: async (args: Prisma.OrderUpdateManyArgs) => {
        assert.deepEqual(args.where, {
          id: stored.id,
          revision: stored.revision,
          archivedAt: null,
        });
        assert.deepEqual(args.data.revision, { increment: 1 });
        assert.equal("addresses" in args.data, false);
        assert.equal("positions" in args.data, false);
        writes.push("claim");
        stored = {
          ...storedOrder(
            args.data.data as unknown as CreateOrderInput,
            stored.revision + 1,
          ),
          edited: true,
        };
        return { count: 1 };
      },
      update: async (args: Prisma.OrderUpdateArgs) => {
        assert.equal(writes.at(-1), "claim");
        assert.deepEqual(args.where, { id: stored.id });
        assert.deepEqual(args.data.addresses?.deleteMany, {});
        assert.deepEqual(args.data.positions?.deleteMany, {});
        writes.push("relations");
        return stored;
      },
    },
    orderActivityEvent: {
      create: async () => {
        writes.push("journal");
      },
    },
  };
  const request = await serve(context, transaction);
  context.mock.method(client.order, "findUnique", async () => stored);
  assert.equal((await (await request("GET")).json()).data.revision, 7);
  const input = { ...orderFixture(), note: "First edit", revision: 7 };
  const first = await request("PUT", input);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.data.revision, 8);
  assert.equal(firstBody.data.data.note, "First edit");
  const stale = await request("PUT", input);
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, "ORDER_CONFLICT");
  const next = await request("PUT", {
    ...input,
    revision: 8,
    note: "Second edit",
  });
  assert.equal(next.status, 200);
  assert.equal((await next.json()).data.revision, 9);
  assert.deepEqual(writes, [
    "claim",
    "relations",
    "journal",
    "claim",
    "relations",
    "journal",
  ]);
});

for (const aboveLimit of [false, true]) {
  test(`catalog-normalized staff update ${aboveLimit ? "above" : "at"} the volume limit is checked before writing`, async (context) => {
    const existing = storedOrder();
    let writes = 0;
    let saved: StoredOrder | undefined;
    const request = await serve(context, {
      order: {
        findUnique: async () => existing,
        updateMany: async (args: Prisma.OrderUpdateManyArgs) => {
          writes++;
          saved = storedOrder(args.data.data as unknown as CreateOrderInput, 1);
          return { count: 1 };
        },
        update: async () => {
          assert.ok(saved);
          writes++;
          return saved;
        },
      },
      catalogFurniture: {
        findMany: async () => [
          { id: 5, name: "Current", volume: 100_000, categories: [] },
        ],
      },
      orderActivityEvent: {
        create: async () => {
          writes++;
        },
      },
    });
    const input = orderFixture();
    input.details!.furniture.items = [
      {
        catalogId: 5,
        name: "Submitted",
        volume: 0,
        quantity: aboveLimit ? 1.00001 : 1,
      },
    ];
    const response = await request("PUT", { ...input, revision: 0 });
    assert.equal(response.status, aboveLimit ? 400 : 200);
    const body = await response.json();
    if (aboveLimit) assert.equal(body.error.code, "INVALID_ORDER");
    else
      assert.equal(body.data.data.details.furniture.items[0].volume, 100_000);
    assert.equal(writes, aboveLimit ? 0 : 3);
  });
}

test("staff update accepts deleted catalog snapshots from persisted relations, not the JSON draft", async (context) => {
  const input = orderFixture();
  input.details!.furniture.items[0]!.catalogId = 123;
  input.details!.extras.services[0]!.catalogId = 456;
  const existing = storedOrder(input);
  const staleJson = structuredClone(input);
  staleJson.details!.furniture.items[0] = {
    catalogId: 9999,
    name: "Untrusted JSON snapshot",
    quantity: 1,
    volume: 1,
  };
  existing.data = JSON.parse(JSON.stringify(staleJson));
  const submitted = structuredClone(input);
  submitted.note = "Contact changed";
  submitted.details!.furniture.items[0]!.quantity = 2;
  let writes = 0;
  let saved: StoredOrder | undefined;
  const request = await serve(context, {
    order: {
      findUnique: async () => existing,
      updateMany: async (args: Prisma.OrderUpdateManyArgs) => {
        writes++;
        const data = args.data.data as unknown as CreateOrderInput;
        assert.equal(
          data.details!.furniture.items[0]!.name,
          input.details!.furniture.items[0]!.name,
        );
        assert.equal(data.details!.furniture.items[0]!.quantity, 2);
        saved = storedOrder(data, 1);
        return { count: 1 };
      },
      update: async () => {
        assert.ok(saved);
        writes++;
        return saved;
      },
    },
    catalogFurniture: client.catalogFurniture,
    catalogService: client.catalogService,
    catalogPacking: client.catalogPacking,
    orderActivityEvent: { create: async () => ({}) },
  });
  const response = await request("PUT", { ...submitted, revision: 0 });
  assert.equal(response.status, 200);
  assert.equal(writes, 2);
  submitted.details!.furniture.items[0]!.catalogId = 789;
  assert.equal(
    (await request("PUT", { ...submitted, revision: 0 })).status,
    400,
  );
  assert.equal(writes, 2);
});

for (const code of ["P2025", "P2034", "P2039"]) {
  for (const action of ["save", "archive", "restore"] as const) {
    test(`${action} handles concurrency error ${code} as 409 without a journal write`, async (context) => {
      let journalWrites = 0;
      const existing = storedOrder();
      if (action === "restore") existing.archivedAt = new Date();
      const conflictingWrite = async (
        args: Prisma.OrderUpdateArgs | Prisma.OrderUpdateManyArgs,
      ) => {
        assert.equal(args.where?.revision, 0);
        assert.deepEqual(args.data.revision, { increment: 1 });
        throw Object.assign(new Error("Concurrent update"), {
          code,
          ...(code === "P2039"
            ? {
                meta: {
                  driverAdapterError: { cause: { originalCode: "1020" } },
                },
              }
            : {}),
        });
      };
      const request = await serve(context, {
        order: {
          findUnique: async () => existing,
          findFirst: async () => existing,
          updateMany: conflictingWrite,
          update: action === "save" ? unexpected : conflictingWrite,
        },
        orderActivityEvent: {
          create: async () => {
            journalWrites++;
          },
        },
      });
      const response = await request(
        action === "save" ? "PUT" : "POST",
        { ...orderFixture(), revision: 0 },
        action === "save" ? "" : `/${action}`,
      );
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error.code, "ORDER_CONFLICT");
      assert.equal(journalWrites, 0);
    });
  }
}

test("archive and restore invalidate old editor revisions without changing the edit date", async (context) => {
  let existing = storedOrder(orderFixture(), 3);
  const editedAt = existing.updatedAt;
  const request = await serve(context, {
    order: {
      findUnique: async () => existing,
      findFirst: async () => existing,
      update: async (args: Prisma.OrderUpdateArgs) => {
        assert.equal(args.where.revision, existing.revision);
        assert.equal(args.data.updatedAt, editedAt);
        existing = {
          ...existing,
          revision: existing.revision + 1,
          archivedAt: args.data.archivedAt as Date | null,
        };
        return existing;
      },
    },
    orderActivityEvent: { create: async () => ({}) },
  });
  assert.equal((await request("POST", undefined, "/archive")).status, 200);
  assert.equal(existing.revision, 4);
  assert.equal((await request("POST", undefined, "/restore")).status, 200);
  assert.equal(existing.revision, 5);
  assert.equal(
    (await request("PUT", { ...orderFixture(), revision: 3 })).status,
    409,
  );
});

for (const state of [
  "active",
  "archived",
  "invalid",
  "invalid-relations",
] as const) {
  test(`copy locks its ${state} source and validates it before consuming a number`, async (context) => {
    const input = orderFixture();
    input.details!.furniture.items[0]!.catalogId = 123;
    input.details!.furniture.volume = 100_000;
    if (state === "invalid") input.details!.furniture.volume = 100_001;
    const source = storedOrder(input, 12);
    if (state === "invalid-relations") source.positions[0]!.volume = 100_001;
    const calls: string[] = [];
    const request = await serve(context, {
      $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
        calls.push("lock");
        assert.match(sql.join("?"), /archivedAt IS NULL FOR UPDATE/u);
        assert.deepEqual(values, [1000]);
        return state === "archived" ? [] : [{ id: source.id }];
      },
      order: {
        findFirst: async () => {
          calls.push("read");
          return source;
        },
        create: async (args: Prisma.OrderCreateArgs) => {
          calls.push("write");
          const saved = storedOrder(
            args.data.data as unknown as CreateOrderInput,
          );
          assert.deepEqual(orderDataWithRelations(saved), input);
          return { id: "copy-test", orderNumber: 1001 };
        },
      },
      orderNumberSequence: {
        update: async () => {
          calls.push("number");
          return { nextValue: 1002 };
        },
      },
      orderImage: { findMany: async () => [] },
      orderActivityEvent: { create: async () => ({}) },
    });
    const response = await request("POST", undefined, "/copy");
    assert.equal(
      response.status,
      state === "active" ? 201 : state === "archived" ? 404 : 400,
    );
    assert.deepEqual(
      calls,
      state === "active"
        ? ["lock", "read", "number", "write"]
        : state === "archived"
          ? ["lock"]
          : ["lock", "read"],
    );
  });
}

test("two concurrent saves with one expected revision cannot overwrite each other", async (context) => {
  let existing = storedOrder();
  let readers = 0;
  let releaseReads!: () => void;
  const bothRead = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  let journalWrites = 0;
  let relationWrites = 0;
  const request = await serve(context, {
    order: {
      findUnique: async () => {
        const snapshot = structuredClone(existing);
        if (++readers === 2) releaseReads();
        await bothRead;
        return snapshot;
      },
      updateMany: async (args: Prisma.OrderUpdateManyArgs) => {
        assert.equal("addresses" in args.data, false);
        assert.equal("positions" in args.data, false);
        if (args.where?.revision !== existing.revision) return { count: 0 };
        existing = storedOrder(
          args.data.data as unknown as CreateOrderInput,
          existing.revision + 1,
        );
        return { count: 1 };
      },
      update: async (args: Prisma.OrderUpdateArgs) => {
        assert.deepEqual(args.where, { id: existing.id });
        assert.equal(existing.revision, 1);
        relationWrites++;
        return existing;
      },
    },
    orderActivityEvent: {
      create: async () => {
        journalWrites++;
      },
    },
  });
  const responses = await Promise.all(
    ["First", "Second"].map((note) =>
      request("PUT", { ...orderFixture(), revision: 0, note }),
    ),
  );
  assert.deepEqual(
    responses.map((response) => response.status).sort(),
    [200, 409],
  );
  assert.equal(existing.revision, 1);
  assert.equal(relationWrites, 1);
  assert.equal(journalWrites, 1);
});

test("copy transaction conflicts return a retryable 409 instead of 500", async (context) => {
  const request = await serve(context, {
    $queryRaw: async () => {
      throw Object.assign(new Error("Concurrent copy/archive"), {
        code: "P2034",
      });
    },
  });
  const response = await request("POST", undefined, "/copy");
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "ORDER_CONFLICT");
});
