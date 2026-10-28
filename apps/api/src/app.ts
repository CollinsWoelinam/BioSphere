import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { config } from "./config.js";
import { sql } from "./db.js";
import { addClient } from "./live.js";
import { analysisRoutes } from "./routes/analysis.js";
import { observationRoutes } from "./routes/observations.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 10 * 1024 * 1024 });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(websocket);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: err.issues });
    }
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status < 500 ? (err as Error).message : "Internal error" });
  });

  app.get("/health", async () => {
    const [{ postgis }] = await sql`SELECT postgis_full_version() AS postgis`;
    return { status: "ok", postgis };
  });

  app.get("/ws", { websocket: true }, (socket) => addClient(socket));

  await app.register(observationRoutes);
  await app.register(analysisRoutes);
  return app;
}
