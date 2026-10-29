import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { ROLES, verifyPassword, type Role, type TokenPayload } from "../auth.js";
import { sql } from "../db.js";
import { createUser, type User } from "../users.js";

const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

const newAccount = z.object({
  email: z.email().max(254),
  name: z.string().trim().min(1).max(100),
  password: z.string().min(10, "Password must be at least 10 characters").max(200),
});

const USER_COLUMNS = sql`id, email, name, role, token_version, disabled_at, created_at`;

// Throttle credential endpoints per IP to slow down password guessing.
const throttled = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance) {
  const session = (user: Pick<User, "id" | "email" | "name" | "role" | "token_version">) => {
    const payload: TokenPayload = { sub: user.id, ver: user.token_version };
    return { token: app.jwt.sign(payload), user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  };

  app.post("/auth/login", throttled, async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    const [user] = await sql<(User & { password_hash: string })[]>`
      SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = lower(${email})
    `;
    // Same response for unknown email, wrong password and disabled account.
    if (!user || user.disabled_at || !(await verifyPassword(password, user.password_hash))) {
      return reply.code(401).send({ error: "Incorrect email or password" });
    }
    return session(user);
  });

  /** Self-registration always creates a citizen-scientist account. */
  app.post("/auth/register", throttled, async (req, reply) => {
    const body = newAccount.parse(req.body);
    const user = await createUser(sql, { ...body, role: "CITIZEN" });
    return reply.code(201).send(session(user));
  });

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (req) => {
    const [user] = await sql<User[]>`SELECT ${USER_COLUMNS} FROM users WHERE id = ${req.user.sub}`;
    return user;
  });

  /** Revokes every token issued to the caller, e.g. after losing a phone. */
  app.post("/auth/logout-all", { onRequest: [app.authenticate] }, async (_req, reply) => {
    await sql`UPDATE users SET token_version = token_version + 1 WHERE id = ${_req.user.sub}`;
    return reply.code(204).send();
  });

  const adminOnly = { onRequest: [app.authenticate, app.requireRole("ADMIN")] };

  app.get("/auth/users", adminOnly, async () => sql<User[]>`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at`);

  /** Admins provision staff accounts (rangers, researchers, other admins). */
  app.post("/auth/users", adminOnly, async (req, reply) => {
    const body = newAccount.extend({ role: z.enum(ROLES) }).parse(req.body);
    const user = await sql.begin(async (tx) => {
      const u = await createUser(tx as unknown as typeof sql, { ...body, role: body.role as Role });
      await audit(tx as unknown as typeof sql, req.user.sub, "user.create", u.email, { role: u.role });
      return u;
    });
    return reply.code(201).send(user);
  });

  /** Change a user's role or disable them. Either change revokes their existing tokens. */
  app.patch("/auth/users/:id", adminOnly, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const body = z
      .object({ role: z.enum(ROLES).optional(), disabled: z.boolean().optional() })
      .refine((b) => b.role !== undefined || b.disabled !== undefined, "Nothing to update")
      .parse(req.body);
    if (id === req.user.sub && (body.disabled || (body.role && body.role !== "ADMIN"))) {
      return reply.code(409).send({ error: "You cannot demote or disable your own account" });
    }
    const user = await sql.begin(async (tx) => {
      const [u] = await tx<User[]>`
      UPDATE users SET
        role = COALESCE(${body.role ?? null}, role),
        disabled_at = CASE
          WHEN ${body.disabled ?? null}::boolean IS NULL THEN disabled_at
          WHEN ${body.disabled ?? null}::boolean THEN COALESCE(disabled_at, now())
          ELSE NULL
        END,
        token_version = token_version + 1
      WHERE id = ${id}
      RETURNING ${USER_COLUMNS}
    `;
      if (u) await audit(tx as unknown as typeof sql, req.user.sub, "user.update", u.email, body);
      return u;
    });
    if (!user) return reply.code(404).send({ error: "User not found" });
    return user;
  });
}
