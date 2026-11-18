import { prisma } from "./db";
import { round2 } from "./http";
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

export interface ZoneSummary {
  orders: number;
  totalKg: number;
  requiresColdChain: boolean;
  orderIds: string[];
}

export function consolidateByZone(list: (Pick<Order, "id" | "deliveryZone" | "requiresColdChain"> & { items: Pick<OrderItem, "quantity">[] })[]) {
  const byZone: Record<string, ZoneSummary> = {};
  for (const o of list) {
    const z = (byZone[o.deliveryZone] ??= { orders: 0, totalKg: 0, requiresColdChain: false, orderIds: [] });
    z.orders++;
    z.totalKg = round2(z.totalKg + o.items.reduce((s, i) => s + i.quantity, 0));
    z.requiresColdChain ||= o.requiresColdChain;
    z.orderIds.push(o.id);
  }
  return byZone;
}
