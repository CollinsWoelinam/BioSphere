// Usage: pnpm --filter @biosphere/api user:create -- --email a@b.org --name "A Ranger" --role RANGER [--password ...]
import { randomBytes } from "node:crypto";
import { parseArgs } from "node:util";
import { ROLES, type Role } from "./auth.js";
import { sql } from "./db.js";
import { createUser } from "./users.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "RANGER" },
    password: { type: "string" },
  },
});

async function main() {
  const role = values.role?.toUpperCase() as Role;
  if (!values.email || !values.name || !ROLES.includes(role)) {
    throw new Error(`--email and --name are required; --role must be one of ${ROLES.join(", ")}`);
  }
  const password = values.password ?? randomBytes(12).toString("base64url");
  const user = await createUser(sql, { email: values.email, name: values.name, role, password });
  console.log(`created ${user.role} ${user.email}`);
  if (!values.password) console.log(`generated password: ${password}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
