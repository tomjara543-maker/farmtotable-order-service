import assert from "node:assert/strict";
import { test } from "node:test";
import { consolidateByZone, toJson } from "../src/orders";

test("consolidateByZone agrupa pedidos por zona sumando kilos y cadena de frío", () => {
  const result = consolidateByZone([
    { id: "o1", deliveryZone: "Norte", requiresColdChain: false, items: [{ quantity: 1.25 }, { quantity: 2.1 }] },
    { id: "o2", deliveryZone: "Sur", requiresColdChain: false, items: [{ quantity: 4 }] },
    { id: "o3", deliveryZone: "Norte", requiresColdChain: true, items: [{ quantity: 0.4 }] },
  ]);

  assert.deepEqual(result, {
    Norte: { orders: 2, totalKg: 3.75, requiresColdChain: true, orderIds: ["o1", "o3"] },
    Sur: { orders: 1, totalKg: 4, requiresColdChain: false, orderIds: ["o2"] },
  });
});

test("toJson expone solo los campos públicos del pedido y sus ítems", () => {
  const createdAt = new Date("2026-11-01T10:00:00Z");
  const json = toJson({
    id: "o1",
    buyerId: "u1",
    deliveryZone: "Norte",
    deliveryAddress: "Calle 1",
    status: "CONFIRMED",
    statusReason: null,
    requiresColdChain: false,
    total: 12000,
    createdAt,
    updatedAt: createdAt,
    items: [{ id: "i1", orderId: "o1", productId: "p1", producerId: "pr1", productName: "Tomate", quantity: 2, unitPrice: 6000 }],
  } as unknown as Parameters<typeof toJson>[0]);

  assert.equal(json.statusReason, undefined);
  assert.equal("updatedAt" in json, false);
  assert.deepEqual(json.items, [{ productId: "p1", producerId: "pr1", productName: "Tomate", quantity: 2, unitPrice: 6000 }]);
  assert.equal(json.total, 12000);
});
