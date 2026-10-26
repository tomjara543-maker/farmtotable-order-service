import { idempotent, prisma } from "./db";
import { publish, subscribe } from "./events";
import { transition } from "./orders";

export async function registerConsumers() {
  await subscribe(
    "order-service",
    [
      "inventory.reserved",
      "inventory.insufficient",
      "inventory.released",
      "payment.authorized",
      "delivery.in_transit",
      "delivery.completed",
      "delivery.failed",
    ],
    idempotent(async ({ eventType, data }) => {
      const orderId: string = data.orderId;
      switch (eventType) {
        case "inventory.reserved": {
          const changed = await transition(orderId, ["PENDING_INVENTORY"], "CONFIRMED", "Stock reservado. Pendiente de pago.");
          const order = changed ?? (await prisma.order.findUnique({ where: { id: orderId } }));
          if (!changed && order?.status === "CANCELLED") {
            publish("order.cancelled", { orderId, buyerId: order.buyerId, previousStatus: "CANCELLED" });
          }
          break;
        }
        case "inventory.insufficient": {
          const names = (data.missing as { productId: string; productName?: string }[]).map((m) => m.productName ?? m.productId);
          await transition(orderId, ["PENDING_INVENTORY"], "REJECTED", `Stock insuficiente: ${names.join(", ")}`);
          break;
        }
        case "inventory.released":
          await transition(orderId, ["CONFIRMED"], "CANCELLED", "La reserva de inventario fue liberada");
          break;
        case "payment.authorized":
          await transition(orderId, ["CONFIRMED"], "PAID", "Pago recibido. Preparando la entrega.");
          break;
        case "delivery.in_transit":
          await transition(orderId, ["PAID", "IN_DELIVERY"], "IN_DELIVERY", "Tu pedido va en camino.");
          break;
        case "delivery.completed":
          await transition(orderId, ["PAID", "IN_DELIVERY"], "DELIVERED", "Entregado.");
          break;
        case "delivery.failed":
          await transition(orderId, ["PAID", "IN_DELIVERY"], "IN_DELIVERY", "No pudimos entregar. Reintentaremos.");
          break;
      }
    }),
  );
}
