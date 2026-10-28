import type { Sql } from "./db.js";
import { hashPassword, type Role } from "./auth.js";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  token_version: number;
  disabled_at: Date | null;
  created_at: Date;
}

export class EmailTakenError extends Error {
  statusCode = 409;
  constructor() {
    super("An account with this email already exists");
  }
}

export async function createUser(
  sql: Sql,
  u: { email: string; name: string; password: string; role: Role },
): Promise<User> {
  const passwordHash = await hashPassword(u.password);
  try {
    const [user] = await sql<User[]>`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (${u.email.trim()}, ${u.name.trim()}, ${passwordHash}, ${u.role})
      RETURNING id, email, name, role, token_version, disabled_at, created_at
    `;
    return user;
  } catch (err) {
    if ((err as { code?: string }).code === "23505") throw new EmailTakenError();
    throw err;
  }
}
