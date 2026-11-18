import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { as, request, Running, startApp, startStub } from "./helpers";

let api: Running;
let catalog: Awaited<ReturnType<typeof startStub>>;

before(async () => {
  catalog = await startStub({
    "GET /products/p-inexistente": () => ({ status: 404, body: { error: "Producto no encontrado" } }),
  });
  process.env.CATALOG_SERVICE_URL = catalog.url;
  const { createApp } = await import("../src/app");
  api = await startApp(createApp());
});

after(async () => {
  await api.close();
  await catalog.close();
});

test("PUT /carts/me/items consulta catalog-service y propaga el 404 si el producto no existe", async () => {
  const res = await request(api.url, "/carts/me/items", {
    method: "PUT",
    headers: as("buyer-1", "BUYER"),
    body: { productId: "p-inexistente", quantity: 2 },
  });

  assert.equal(res.status, 404);
  assert.equal(res.body.error, "Producto no encontrado");
  assert.equal(catalog.calls.length, 1);
  assert.equal(catalog.calls[0].url, "/products/p-inexistente");
  assert.equal(catalog.calls[0].headers["x-user-role"], "ADMIN");
});

test("POST /carts/me/checkout exige sesión, rol comprador y datos de entrega", async () => {
  const anonymous = await request(api.url, "/carts/me/checkout", { method: "POST", body: {} });
  assert.equal(anonymous.status, 401);

  const producer = await request(api.url, "/carts/me/checkout", { method: "POST", headers: as("p-1", "PRODUCER"), body: {} });
  assert.equal(producer.status, 403);

  const invalid = await request(api.url, "/carts/me/checkout", {
    method: "POST",
    headers: as("buyer-1", "BUYER"),
    body: { deliveryZone: " ", deliveryAddress: "Calle 1" },
  });
  assert.equal(invalid.status, 400);
  assert.match(invalid.body.error, /deliveryZone/);
});
