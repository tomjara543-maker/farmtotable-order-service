import cors from "cors";
import express from "express";
import { registerConsumers } from "./consumers";
import { connectEvents } from "./events";
import { errorHandler } from "./http";
import { cartRoutes, orderRoutes } from "./routes";

const PORT = Number(process.env.PORT ?? 4003);

async function main() {
  await registerConsumers();
  await connectEvents();

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ service: "order-service", status: "ok" }));
  app.use("/carts", cartRoutes());
  app.use("/orders", orderRoutes());
  app.use(errorHandler);

  app.listen(PORT, () => console.log(`order-service escuchando en http://localhost:${PORT}`));
}

main();
