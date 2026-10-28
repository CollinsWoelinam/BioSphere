import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";
import { whereObservations } from "../filters.js";
import { ingestObservations, toFeature, type ObservationRow } from "../ingest.js";
import { broadcast } from "../live.js";
import { bucket, observationFilter, observationIngest } from "../schemas.js";

export async function observationRoutes(app: FastifyInstance) {
  app.post("/observations", async (req, reply) => {
    const body = observationIngest.parse(req.body);
    const features = body.type === "Feature" ? [body] : body.features;
    const { inserted, duplicateIds } = await ingestObservations(sql, features);

    if (inserted.length) {
      broadcast({ type: "observations.created", features: inserted.map(toFeature) });
    }
    return reply.code(inserted.length ? 201 : 200).send({
      accepted: inserted.map((r) => r.id),
      duplicates: duplicateIds,
    });
  });

  app.get("/observations", async (req) => {
    const query = observationFilter
      .extend({ limit: z.coerce.number().int().min(1).max(100_000).default(50_000) })
      .parse(req.query);

    const rows = await sql<ObservationRow[]>`
      SELECT id, species_name, is_invasive, observer_type,
        ST_X(location) AS lon, ST_Y(location) AS lat, accuracy_m, altitude_m,
        individual_count, habitat_notes, device_id, observed_at
      FROM species_observations
      ${whereObservations(sql, query)}
      ORDER BY observed_at
      LIMIT ${query.limit}
    `;
    return { type: "FeatureCollection", features: rows.map(toFeature) };
  });

  /** Sighting counts per time bucket, used to draw the time-slider histogram. */
  app.get("/observations/timeline", async (req) => {
    const query = observationFilter.extend({ bucket }).parse(req.query);
    const rows = await sql`
      SELECT date_trunc(${query.bucket}, observed_at) AS bucket_start, count(*) AS sightings
      FROM species_observations
      ${whereObservations(sql, query)}
      GROUP BY 1
      ORDER BY 1
    `;
    return { bucket: query.bucket, buckets: rows };
  });

  app.get("/species", async () => {
    return sql`
      SELECT species_name, is_invasive, sightings, first_seen, last_seen,
        ARRAY[ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext)] AS bbox
      FROM (
        SELECT species_name, bool_or(is_invasive) AS is_invasive, count(*) AS sightings,
          min(observed_at) AS first_seen, max(observed_at) AS last_seen,
          ST_Extent(location) AS ext
        FROM species_observations
        GROUP BY species_name
      ) s
      ORDER BY species_name
    `;
  });
}
