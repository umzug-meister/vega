import assert from "node:assert/strict";
import test from "node:test";
import { orderRelationCreates } from "../src/orders/order-relations.js";
import { orderFixture } from "./fixtures/order.js";

test("relational projection keeps optional addresses, mixed position order and independent row identities", () => {
  const input = orderFixture();
  const first = orderRelationCreates(input);
  const copy = orderRelationCreates(input);
  assert.deepEqual(
    first.addresses.create.map((row) => row.role),
    ["FROM", "TO", "SECONDARY_FROM", "SECONDARY_TO"],
  );
  assert.deepEqual(first.addresses.create[0]?.details, {
    floor: "EG",
    parkingSlot: true,
  });
  assert.deepEqual(
    first.positions.create.map((row) => [row.kind, row.position]),
    [
      ["FURNITURE", 0],
      ["SERVICE", 0],
      ["PACKAGING", 1],
      ["SERVICE", 2],
    ],
  );
  assert.equal(first.positions.create[0]?.quantity, 1.5);
  assert.notEqual(first.addresses.create[0]?.id, copy.addresses.create[0]?.id);
  assert.notEqual(first.positions.create[0]?.id, copy.positions.create[0]?.id);
});

test("relational positions omit staff unit prices while order JSON keeps priced packmaterial inputs", () => {
  const input = orderFixture();
  input.details!.extras.services = [
    {
      kind: "packaging",
      name: "Karton",
      quantity: 2,
      catalogId: 12,
      unitPrice: 3.5,
    },
    {
      kind: "service",
      name: "Montage",
      quantity: 1,
      catalogId: 4,
      unitPrice: 85,
    },
  ];

  const { positions } = orderRelationCreates(input);

  assert.deepEqual(
    positions.create
      .filter((row) => row.kind !== "FURNITURE")
      .map((row) => ({
        kind: row.kind,
        position: row.position,
        name: row.name,
        quantity: row.quantity,
        catalogId: row.catalogId,
      })),
    [
      {
        kind: "PACKAGING",
        position: 0,
        name: "Karton",
        quantity: 2,
        catalogId: 12,
      },
      {
        kind: "SERVICE",
        position: 1,
        name: "Montage",
        quantity: 1,
        catalogId: 4,
      },
    ],
  );
  assert.ok(
    positions.create
      .filter((row) => row.kind !== "FURNITURE")
      .every((row) => !Object.hasOwn(row, "unitPrice")),
  );
  assert.equal(input.details!.extras.services[0]!.unitPrice, 3.5);
  assert.equal(input.details!.extras.services[1]!.unitPrice, 85);
});

test("incomplete staff drafts still create the two required address rows and no positions", () => {
  const rows = orderRelationCreates({
    customer: { firstName: "", lastName: "", phone: "" },
    from: { street: "", postalCode: "", city: "" },
    to: { street: "", postalCode: "", city: "" },
    movingDate: "",
  });
  assert.equal(rows.addresses.create.length, 2);
  assert.equal(rows.addresses.create[0]?.street, "");
  assert.deepEqual(rows.positions.create, []);
});
