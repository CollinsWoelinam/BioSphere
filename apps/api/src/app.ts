import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { ZodError } from "zod";
import { authPlugin, resolveViewer, type TokenPayload } from "./auth.js";
import { config } from "./config.js";
import { sql } from "./db.js";
import { addClient } from "./live.js";
import { analysisRoutes } from "./routes/analysis.js";
import { authRoutes } from "./routes/auth.js";
import { observationRoutes } from "./routes/observations.js";
import { photoRoutes } from "./routes/photos.js";

export async function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, bodyLimit: 10 * 1024 * 1024 });

  await app.register(cors, { origin: config.corsOrigin });
  await app.register(rateLimit, { global: false });
  await app.register(websocket);
  await app.register(multipart, { limits: { files: 1, fileSize: config.maxPhotoBytes } });
  await app.register(authPlugin);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: err.issues });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status < 500 ? (err as Error).message : "Internal error" });
  });

  app.get("/health", async () => {
    const [{ postgis }] = await sql`SELECT postgis_full_version() AS postgis`;
    return { status: "ok", postgis };
  });

  await app.register(authRoutes);

  // Browsers cannot set headers on a WebSocket, so the token travels as ?token=.
  app.get("/ws", { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    try {
      const viewer = await resolveViewer(app.jwt.verify<TokenPayload>(token ?? ""));
      if (viewer) return addClient(socket, viewer);
    } catch {
      // fall through
    }
    socket.close(4401, "Authentication required");
  });

  // Everything below requires a signed-in user.
  await app.register(async (secured) => {
    secured.addHook("onRequest", secured.authenticate);
    await secured.register(observationRoutes);
    await secured.register(analysisRoutes);
    await secured.register(photoRoutes);
  });

  return app;
}
