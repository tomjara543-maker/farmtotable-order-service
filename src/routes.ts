import { Router } from "express";
import { z } from "zod";
import { requireUser, userOf } from "./auth";
import { prisma } from "./db";
import { publish } from "./events";
import { OrderStatus } from "./generated/prisma/client";
import { callService, HttpError, notFound } from "./http";
import { consolidateByZone, include, toJson } from "./orders";

const CATALOG_URL = process.env.CATALOG_SERVICE_URL;

interface Product {
  id: string;
  producerId: string;
  name: string;
  currentPrice: number;
  availableKg: number;
  requiresColdChain: boolean;
}

const getProduct = (id: string) => callService<Product>(CATALOG_URL, `/products/${encodeURIComponent(id)}`);

const itemSchema = z.object({
  productId: z.string().min(1, "El campo productId es obligatorio"),
  quantity: z.coerce.number().positive("quantity debe ser mayor que 0"),
});

const checkoutSchema = z.object({
  deliveryZone: z.string().trim().min(1, "El campo deliveryZone es obligatorio"),
  deliveryAddress: z.string().trim().min(1, "El campo deliveryAddress es obligatorio"),
});

const ORDER_STATUSES = Object.values(OrderStatus) as string[];
const CANCELLABLE: OrderStatus[] = ["PENDING_INVENTORY", "CONFIRMED", "PAID"];

async function cartOf(buyerId: string) {
  const items = await prisma.cartItem.findMany({ where: { buyerId }, orderBy: { updatedAt: "asc" } });
  return { buyerId, items: items.map(({ productId, quantity }) => ({ productId, quantity })) };
}

export function cartRoutes() {
  const router = Router();
  router.use(requireUser("BUYER"));

  router.get("/me", async (_req, res) => {
    res.json(await cartOf(userOf(res).id));
  });

  router.put("/me/items", async (req, res) => {
    const { productId, quantity } = itemSchema.parse(req.body);
    await getProduct(productId);
    const buyerId = userOf(res).id;
    await prisma.cartItem.upsert({
      where: { buyerId_productId: { buyerId, productId } },
      create: { buyerId, productId, quantity },
      update: { quantity },
    });
    res.json(await cartOf(buyerId));
  });

  router.delete("/me/items/:productId", async (req, res) => {
    const buyerId = userOf(res).id;
    await prisma.cartItem.deleteMany({ where: { buyerId, productId: String(req.params.productId) } });
    res.json(await cartOf(buyerId));
  });

  router.post("/me/checkout", async (req, res) => {
    const { deliveryZone, deliveryAddress } = checkoutSchema.parse(req.body);
    const buyerId = userOf(res).id;
    const cart = await prisma.cartItem.findMany({ where: { buyerId } });
    if (cart.length === 0) throw new HttpError(422, "El pedido no tiene productos");

    const items = [];
    let requiresColdChain = false;
    for (const item of cart) {
      const product = await getProduct(item.productId).catch((err) => {
        throw err instanceof HttpError && err.status === 404 ? new HttpError(422, `Producto ${item.productId} no existe`) : err;
      });
      if (product.availableKg < item.quantity) {
        throw new HttpError(422, `Stock insuficiente de ${product.name} (quedan ${product.availableKg} kg)`);
      }
      requiresColdChain ||= product.requiresColdChain;
      items.push({
        productId: product.id,
        producerId: product.producerId,
        productName: product.name,
        quantity: item.quantity,
        unitPrice: product.currentPrice,
      });
    }

    const total = Math.round(items.reduce((s, i) => s + i.quantity * i.unitPrice, 0));
    const [order] = await prisma.$transaction([
      prisma.order.create({
        data: { buyerId, deliveryZone, deliveryAddress, requiresColdChain, total, statusReason: "Reservando stock…", items: { create: items } },
        include,
      }),
      prisma.cartItem.deleteMany({ where: { buyerId } }),
    ]);
    publish("order.created", { orderId: order.id, buyerId, deliveryZone, total, requiresColdChain, items });
    res.status(201).json(toJson(order));
  });

  return router;
}

export function orderRoutes() {
  const router = Router();

  router.get("/mine", requireUser("BUYER"), async (_req, res) => {
    const list = await prisma.order.findMany({ where: { buyerId: userOf(res).id }, include, orderBy: { createdAt: "desc" } });
    res.json(list.map(toJson));
  });

  router.get("/", requireUser("ADMIN"), async (req, res) => {
    const status = typeof req.query.status === "string" && ORDER_STATUSES.includes(req.query.status) ? (req.query.status as OrderStatus) : undefined;
    const list = await prisma.order.findMany({ where: { status }, include, orderBy: { createdAt: "desc" } });
    res.json(list.map(toJson));
  });

  router.get("/consolidated", requireUser("ADMIN"), async (_req, res) => {
    const list = await prisma.order.findMany({ where: { status: { in: ["CONFIRMED", "PAID"] } }, include, orderBy: { createdAt: "asc" } });
    res.json(consolidateByZone(list));
  });

  async function visibleOrder(id: string, user: { id: string; role: string }) {
    const order = await prisma.order.findUnique({ where: { id }, include });
    if (!order || (user.role !== "ADMIN" && order.buyerId !== user.id)) throw notFound("Pedido");
    return order;
  }

  router.get("/:id", requireUser(), async (req, res) => {
    res.json(toJson(await visibleOrder(String(req.params.id), userOf(res))));
  });

  router.post("/:id/cancel", requireUser(), async (req, res) => {
    const order = await visibleOrder(String(req.params.id), userOf(res));
    if (!CANCELLABLE.includes(order.status)) throw new HttpError(409, "El pedido ya no se puede cancelar");
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { status: "CANCELLED", statusReason: "Cancelado por el comprador" },
      include,
    });
    publish("order.cancelled", { orderId: order.id, buyerId: order.buyerId, previousStatus: order.status });
    res.json(toJson(updated));
  });

  return router;
}
