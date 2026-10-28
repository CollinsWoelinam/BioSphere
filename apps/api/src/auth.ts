import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import { config } from "./config.js";
import { sql } from "./db.js";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const ROLES = ["ADMIN", "RESEARCHER", "RANGER", "CITIZEN"] as const;
export type Role = (typeof ROLES)[number];

/** The signed-in account, loaded fresh from the database on every request. */
export interface Viewer {
  sub: string;
  role: Role;
  name: string;
}

/**
 * What the token carries. Role is deliberately absent: it is read from the database
 * so demotions apply immediately, and `ver` must match users.token_version, so
 * bumping the version revokes every outstanding token for that user.
 */
export interface TokenPayload {
  sub: string;
  ver: number;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: Viewer;
  }
}

/** Returns the viewer for a verified token, or null if it was revoked or the account disabled. */
export async function resolveViewer(token: TokenPayload): Promise<Viewer | null> {
  const [u] = await sql<{ role: Role; name: string }[]>`
    SELECT role, name FROM users
    WHERE id = ${token.sub} AND token_version = ${token.ver} AND disabled_at IS NULL
  `;
  return u ? { sub: token.sub, role: u.role, name: u.name } : null;
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
    let viewer: Viewer | null = null;
    try {
      viewer = await resolveViewer(await req.jwtVerify<TokenPayload>());
    } catch {
      // invalid signature, malformed or expired token
    }
    if (!viewer) return reply.code(401).send({ error: "Authentication required" });
    req.user = viewer;
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
