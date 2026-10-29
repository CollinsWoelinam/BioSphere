import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { sql, type Sql } from "../db.js";

const speciesName = z.string().trim().min(1).max(100);

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("onRequest", app.requireRole("ADMIN"));

  /** Full registry, including species with no sightings yet. */
  app.get("/admin/species", async () => {
    return sql`
      SELECT s.species_name, s.is_invasive, s.is_sensitive,
        COALESCE(c.sightings, 0)::int AS sightings, c.last_seen
      FROM species s
      LEFT JOIN (
        SELECT species_name, count(*) AS sightings, max(observed_at) AS last_seen
        FROM species_observations GROUP BY species_name
      ) c USING (species_name)
      ORDER BY s.species_name
    `;
  });

  /**
   * Create or update a registry entry. Observations store is_invasive too (for
   * index-friendly filtering), so a change is applied to existing sightings in
   * the same transaction.
   */
  app.put("/admin/species/:name", async (req) => {
    const { name } = z.object({ name: speciesName }).parse(req.params);
    const body = z
      .object({ is_invasive: z.boolean().optional(), is_sensitive: z.boolean().optional() })
      .refine((b) => b.is_invasive !== undefined || b.is_sensitive !== undefined, "Nothing to update")
      .parse(req.body);

    return sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      const [before] = await tx`SELECT is_invasive, is_sensitive FROM species WHERE species_name = ${name}`;
      const [row] = await tx`
        INSERT INTO species (species_name, is_invasive, is_sensitive)
        VALUES (${name}, ${body.is_invasive ?? false}, ${body.is_sensitive ?? false})
        ON CONFLICT (species_name) DO UPDATE SET
          is_invasive = COALESCE(${body.is_invasive ?? null}, species.is_invasive),
          is_sensitive = COALESCE(${body.is_sensitive ?? null}, species.is_sensitive)
        RETURNING species_name, is_invasive, is_sensitive
      `;
      if (before?.is_invasive !== row.is_invasive) {
        await tx`UPDATE species_observations SET is_invasive = ${row.is_invasive} WHERE species_name = ${name}`;
      }
      await audit(tx, req.user.sub, before ? "species.update" : "species.create", name, {
        before: before ?? null,
        after: { is_invasive: row.is_invasive, is_sensitive: row.is_sensitive },
      });
      return row;
    });
  });

  app.get("/admin/audit", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    return sql`
      SELECT a.id, a.action, a.target, a.details, a.created_at, u.email AS actor_email
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${limit}
    `;
  });
}
