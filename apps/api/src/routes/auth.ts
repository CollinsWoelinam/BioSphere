import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ROLES, verifyPassword, type Role, type Viewer } from "../auth.js";
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

// Throttle credential endpoints per IP to slow down password guessing.
const throttled = { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance) {
  const session = (user: Pick<User, "id" | "email" | "name" | "role">) => {
    const viewer: Viewer = { sub: user.id, role: user.role, name: user.name };
    return { token: app.jwt.sign(viewer), user: { id: user.id, email: user.email, name: user.name, role: user.role } };
  };

  app.post("/auth/login", throttled, async (req, reply) => {
    const { email, password } = credentials.parse(req.body);
    const [user] = await sql<(User & { password_hash: string })[]>`
      SELECT id, email, name, role, password_hash FROM users WHERE lower(email) = lower(${email})
    `;
    if (!user || !(await verifyPassword(password, user.password_hash))) {
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

  app.get("/auth/me", { onRequest: [app.authenticate] }, async (req, reply) => {
    const [user] = await sql<User[]>`SELECT id, email, name, role, created_at FROM users WHERE id = ${req.user.sub}`;
    if (!user) return reply.code(401).send({ error: "Account no longer exists" });
    return user;
  });

  /** Admins provision staff accounts (rangers, researchers, other admins). */
  app.post(
    "/auth/users",
    { onRequest: [app.authenticate, app.requireRole("ADMIN")] },
    async (req, reply) => {
      const body = newAccount.extend({ role: z.enum(ROLES) }).parse(req.body);
      const user = await createUser(sql, { ...body, role: body.role as Role });
      return reply.code(201).send(user);
    },
  );
}
