import { prisma } from "./db";
import { Order, OrderItem, OrderStatus } from "./generated/prisma/client";

export const include = { items: true } as const;

export const toJson = (o: Order & { items: OrderItem[] }) => ({
  id: o.id,
  buyerId: o.buyerId,
  deliveryZone: o.deliveryZone,
  deliveryAddress: o.deliveryAddress,
  status: o.status,
  statusReason: o.statusReason ?? undefined,
  requiresColdChain: o.requiresColdChain,
  items: o.items.map(({ productId, producerId, productName, quantity, unitPrice }) => ({ productId, producerId, productName, quantity, unitPrice })),
  total: o.total,
  createdAt: o.createdAt,
});

export async function transition(orderId: string, from: OrderStatus[], status: OrderStatus, statusReason: string) {
  const { count } = await prisma.order.updateMany({ where: { id: orderId, status: { in: from } }, data: { status, statusReason } });
  return count ? prisma.order.findUnique({ where: { id: orderId }, include }) : null;
}
