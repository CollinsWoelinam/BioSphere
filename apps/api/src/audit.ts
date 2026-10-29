import type { Sql } from "./db.js";

/** Appends to the audit log. Pass the transaction so the entry commits with the change. */
export async function audit(
  tx: Sql,
  actorId: string,
  action: string,
  target: string,
  details: Record<string, unknown> = {},
) {
  await tx`
    INSERT INTO audit_log (actor_id, action, target, details)
    VALUES (${actorId}, ${action}, ${target}, ${tx.json(details as never)})
  `;
}
