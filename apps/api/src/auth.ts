import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { config } from "./config.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const ROLES = ["ADMIN", "RESEARCHER", "RANGER", "CITIZEN"] as const;
export type Role = (typeof ROLES)[number];

export interface Viewer {
  sub: string;
  role: Role;
  name: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: Viewer;
    user: Viewer;
  }
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/** Everyone except citizen scientists may see exact locations of sensitive species. */
export const seesExactLocations = (v: Viewer) => v.role !== "CITIZEN";

export const observerTypeFor = (v: Viewer) => (v.role === "CITIZEN" ? "CITIZEN" : "RANGER");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await scrypt(password, Buffer.from(salt, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export const authPlugin = fp(async (app) => {
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: config.jwtTtl } });

  app.decorate("authenticate", async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      return reply.code(401).send({ error: "Authentication required" });
    }
  });

  app.decorate(
    "requireRole",
    (...roles: Role[]) =>
      async (req: FastifyRequest, reply: FastifyReply) => {
        if (!roles.includes(req.user.role)) {
          return reply.code(403).send({ error: "Insufficient permissions" });
        }
      },
  );
});
