# order-service

Carrito, pedidos y consolidación por zona. Parte de **FarmToTable** (marketplace agrícola con microservicios orientados a eventos).

Estado: **Implementado** con PostgreSQL (Prisma) y RabbitMQ. Probado de punta a punta a través del API Gateway.

- Puerto local: `4003` · Ruta pública en el API Gateway: `/api/orders, /api/carts`
- Base de datos propia (`DATABASE_URL`), nunca compartida con otro servicio
- Eventos por RabbitMQ (exchange topic `farmtotable.events`, ver `src/events.ts`)

## Contrato REST

Es lo que ya consume el frontend (y lo que simula su modo demo en `src/lib/mock/server.ts` del repo del frontend).
El API Gateway valida el JWT y reenvía `x-user-id` / `x-user-role`; usa `requireUser()` de `src/auth.ts`.

| Método | Ruta | Acceso | Descripción |
|---|---|---|---|
| `GET` | `/carts/me` | BUYER | `{ buyerId, items[] }` |
| `PUT` | `/carts/me/items` | BUYER | `{ productId, quantity }` añade o actualiza |
| `DELETE` | `/carts/me/items/:productId` | BUYER | Quita |
| `POST` | `/carts/me/checkout` | BUYER | `{ deliveryZone, deliveryAddress }` → 201 pedido `PENDING_INVENTORY`, publica `order.created`; 422 si falta stock |
| `GET` | `/orders/mine` | BUYER | Pedidos del comprador |
| `GET` | `/orders?status=` | ADMIN | Todos |
| `GET` | `/orders/consolidated` | ADMIN | Pedidos CONFIRMED/PAID agrupados por zona |
| `GET` | `/orders/:id` | dueño / ADMIN | Detalle |
| `POST` | `/orders/:id/cancel` | dueño / ADMIN | Solo PENDING_INVENTORY, CONFIRMED o PAID → publica `order.cancelled` |

Errores: `{ "error": "mensaje" }` con 400 (validación zod), 401, 403, 404, 409 (estado inválido) o 422 (regla de negocio).

## Eventos

Publica:
- `order.created`
- `order.cancelled`

Consume:
- `inventory.reserved` → CONFIRMED
- `inventory.insufficient` → REJECTED
- `inventory.released` → CANCELLED (si estaba CONFIRMED)
- `payment.authorized` → PAID
- `delivery.in_transit` → IN_DELIVERY
- `delivery.completed` → DELIVERED
- `delivery.failed` → motivo "Reintentaremos"

Todo consumidor debe envolverse en `idempotent()` (`src/db.ts`).

## Modelo de datos (Prisma)

- `Cart` / `CartItem` (buyerId, productId, quantity)
- `Order` (id, buyerId, deliveryZone, deliveryAddress, status, statusReason, requiresColdChain, total, createdAt)
- `OrderItem` (orderId, productId, producerId, productName, quantity, unitPrice)
- Estados: PENDING_INVENTORY → CONFIRMED → PAID → IN_DELIVERY → DELIVERED (o REJECTED / CANCELLED)

## Desarrollo

```bash
cp .env.example .env    # ajusta DATABASE_URL
npm install
npm run db:migrate      # crea/aplica migraciones
npm run dev
```

## Despliegue

`Dockerfile` + `render.yaml` (Render) y `.github/workflows/ci.yml`: compila en cada push/PR y, en `main`,
publica la imagen en GHCR y dispara el deploy hook de Render si existe el secreto `RENDER_DEPLOY_HOOK_URL`.
