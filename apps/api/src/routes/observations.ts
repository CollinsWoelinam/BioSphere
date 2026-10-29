import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { observerTypeFor } from "../auth.js";
import { sql } from "../db.js";
import { generalizedFor, locationFor, whereObservations } from "../filters.js";
import { ingestObservations, toFeature, type ObservationRow } from "../ingest.js";
import { broadcastObservations } from "../live.js";
import { bucket, observationFilter, observationIngest } from "../schemas.js";

export async function observationRoutes(app: FastifyInstance) {
  app.post("/observations", async (req, reply) => {
    const body = observationIngest.parse(req.body);
    const features = body.type === "Feature" ? [body] : body.features;
    const { inserted, duplicateIds } = await ingestObservations(sql, features, {
      id: req.user.sub,
      observerType: observerTypeFor(req.user),
    });

    if (inserted.length) {
      broadcastObservations(sql, inserted).catch((err) => req.log.error(err, "live broadcast failed"));
    }
    return reply.code(inserted.length ? 201 : 200).send({
      accepted: inserted.map((r) => r.id),
      duplicates: duplicateIds,
    });
  });

  /** Sightings as GeoJSON. Sensitive species are generalised for citizen viewers. */
  app.get("/observations", async (req) => {
    const query = observationFilter
      .extend({ limit: z.coerce.number().int().min(1).max(100_000).default(50_000) })
      .parse(req.query);
    const v = req.user;

    const rows = await sql<ObservationRow[]>`
      SELECT id, species_name, is_invasive, observer_type,
        ST_X(loc) AS lon, ST_Y(loc) AS lat,
        CASE WHEN generalized THEN NULL ELSE accuracy_m END AS accuracy_m,
        altitude_m, individual_count,
        CASE WHEN generalized THEN NULL ELSE habitat_notes END AS habitat_notes,
        device_id, observed_at, generalized,
        -- Photos of sensitive species are hidden from viewers who get generalised points.
        CASE WHEN generalized THEN 0
          ELSE (SELECT count(*)::int FROM observation_photos p WHERE p.observation_id = o.id)
        END AS photo_count
      FROM (
        SELECT *, ${locationFor(sql, v)} AS loc, ${generalizedFor(sql, v)} AS generalized
        FROM species_observations
        ${whereObservations(sql, query, v, { generalized: true })}
      ) o
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
      ${whereObservations(sql, query, req.user, { generalized: true })}
      GROUP BY 1
      ORDER BY 1
    `;
    return { bucket: query.bucket, buckets: rows };
  });

  app.get("/species", async (req) => {
    const v = req.user;
    return sql`
      SELECT s.species_name, sp.is_invasive, sp.is_sensitive, s.sightings, s.first_seen, s.last_seen,
        ARRAY[ST_XMin(ext), ST_YMin(ext), ST_XMax(ext), ST_YMax(ext)] AS bbox
      FROM (
        SELECT species_name, count(*) AS sightings,
          min(observed_at) AS first_seen, max(observed_at) AS last_seen,
          ST_Extent(${locationFor(sql, v)}) AS ext
        FROM species_observations
        GROUP BY species_name
      ) s
      JOIN species sp USING (species_name)
      ORDER BY s.species_name
    `;
  });
}
