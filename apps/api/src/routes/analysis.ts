import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { sql } from "../db.js";
import { whereObservations } from "../filters.js";
import { bucket, corePercent, observationFilter, pctConvex, type ObservationFilter } from "../schemas.js";

const hullParams = z.object({
  method: z.enum(["concave", "convex"]).default("concave"),
  pct: pctConvex,
  core: corePercent,
});
type HullParams = z.infer<typeof hullParams>;

/**
 * Subquery yielding (species_name, n, hull) per species. Points are first ranked by
 * distance from their species centroid so `core` < 100 drops the outermost outliers
 * before the hull is built (e.g. core=95 gives the standard MCP95 home range).
 */
function hullSubquery(f: ObservationFilter, p: HullParams) {
  const hull = p.method === "convex" ? sql`ST_ConvexHull(g)` : sql`ST_ConcaveHull(g, ${p.pct})`;
  return sql`
    WITH filtered AS (
      SELECT species_name, location FROM species_observations ${whereObservations(sql, f)}
    ),
    centroids AS (
      SELECT species_name, ST_Centroid(ST_Collect(location)) AS c FROM filtered GROUP BY species_name
    ),
    ranked AS (
      SELECT f.species_name, f.location,
        percent_rank() OVER (
          PARTITION BY f.species_name ORDER BY ST_DistanceSphere(f.location, c.c)
        ) AS pr
      FROM filtered f JOIN centroids c USING (species_name)
    ),
    core AS (
      SELECT species_name, count(*) AS n, ST_Collect(location) AS g
      FROM ranked WHERE pr <= ${p.core / 100}
      GROUP BY species_name
      HAVING count(DISTINCT location) >= 3
    )
    SELECT species_name, n, g, ${hull} AS hull FROM core
  `;
}

const geojson = (col: string) => sql.unsafe(`ST_AsGeoJSON(${col}, 6)::json`);
const areaKm2 = (col: string) => sql.unsafe(`(ST_Area((${col})::geography) / 1e6)`);

export async function analysisRoutes(app: FastifyInstance) {
  /** Home range polygon (MCP or concave/alpha-shape hull) per species. */
  app.get("/analysis/home-range", async (req) => {
    const q = observationFilter.extend(hullParams.shape).parse(req.query);
    const rows = await sql`
      SELECT species_name, n AS sightings,
        ${geojson("hull")} AS geometry,
        ${areaKm2("hull")} AS area_sq_km,
        ST_Perimeter(hull::geography) / 1e3 AS perimeter_km,
        ${areaKm2("ST_ConvexHull(g)")} AS mcp_area_sq_km
      FROM (${hullSubquery(q, q)}) h
      ORDER BY species_name
    `;
    return {
      type: "FeatureCollection",
      method: q.method,
      pct_convex: q.pct,
      core_percent: q.core,
      features: rows.map(({ geometry, ...properties }) => ({
        type: "Feature",
        geometry,
        properties,
      })),
    };
  });

  /** Habitat expansion / contraction between two periods for one species. */
  app.get("/analysis/home-range/compare", async (req, reply) => {
    const q = hullParams
      .extend({
        species: z.string().min(1),
        a_from: z.iso.datetime({ offset: true }),
        a_to: z.iso.datetime({ offset: true }),
        b_from: z.iso.datetime({ offset: true }),
        b_to: z.iso.datetime({ offset: true }),
      })
      .parse(req.query);
    const base = { species: [q.species] };
    const [row] = await sql`
      WITH a AS (${hullSubquery({ ...base, from: q.a_from, to: q.a_to }, q)}),
           b AS (${hullSubquery({ ...base, from: q.b_from, to: q.b_to }, q)})
      SELECT a.n AS a_sightings, b.n AS b_sightings,
        ${geojson("a.hull")} AS a_geometry, ${areaKm2("a.hull")} AS a_area_sq_km,
        ${geojson("b.hull")} AS b_geometry, ${areaKm2("b.hull")} AS b_area_sq_km,
        ${geojson("ST_Difference(b.hull, a.hull)")} AS gained_geometry,
        ${areaKm2("ST_Difference(b.hull, a.hull)")} AS gained_sq_km,
        ${geojson("ST_Difference(a.hull, b.hull)")} AS lost_geometry,
        ${areaKm2("ST_Difference(a.hull, b.hull)")} AS lost_sq_km,
        ${areaKm2("ST_Intersection(a.hull, b.hull)")} AS stable_sq_km
      FROM a CROSS JOIN b
    `;
    if (!row) {
      return reply.code(422).send({
        error: "Each period needs at least 3 distinct sightings to build a hull.",
      });
    }
    const a = Number(row.a_area_sq_km);
    const b = Number(row.b_area_sq_km);
    return { ...row, change_sq_km: b - a, change_percent: a > 0 ? ((b - a) / a) * 100 : null };
  });

  /** Chronological centroid displacement vectors per species, for migration animation. */
  app.get("/analysis/trajectory", async (req) => {
    const q = observationFilter.extend({ bucket }).parse(req.query);
    const rows = await sql`
      WITH buckets AS (
        SELECT species_name, date_trunc(${q.bucket}, observed_at) AS t,
          count(*) AS sightings, sum(individual_count) AS individuals,
          ST_Centroid(ST_Collect(location)) AS c
        FROM species_observations
        ${whereObservations(sql, q)}
        GROUP BY 1, 2
      ),
      seq AS (
        SELECT *, lag(c) OVER w AS prev_c, lag(t) OVER w AS prev_t
        FROM buckets
        WINDOW w AS (PARTITION BY species_name ORDER BY t)
      )
      SELECT species_name, t AS bucket_start, sightings, individuals,
        ARRAY[ST_X(c), ST_Y(c)] AS position,
        CASE WHEN prev_c IS NULL THEN NULL ELSE ARRAY[ST_X(prev_c), ST_Y(prev_c)] END AS from_position,
        ST_DistanceSphere(prev_c, c) / 1000 AS distance_km,
        degrees(ST_Azimuth(prev_c, c)) AS bearing_deg,
        ST_DistanceSphere(prev_c, c) / 1000
          / NULLIF(EXTRACT(EPOCH FROM t - prev_t) / 86400, 0) AS speed_km_per_day
      FROM seq
      ORDER BY species_name, t
    `;
    const bySpecies = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) {
      const list = bySpecies.get(r.species_name) ?? [];
      list.push(r);
      bySpecies.set(r.species_name, list);
    }
    return {
      bucket: q.bucket,
      species: [...bySpecies].map(([species_name, steps]) => ({
        species_name,
        total_distance_km: steps.reduce((s, x) => s + (Number(x.distance_km) || 0), 0),
        steps: steps.map(({ species_name: _, ...s }) => s),
      })),
    };
  });

  /** Hexagonal binning (counts per cell) for density surfaces over large datasets. */
  app.get("/analysis/density", async (req) => {
    const q = observationFilter
      .extend({ cell_km: z.coerce.number().min(0.1).max(100).default(3) })
      .parse(req.query);
    const rows = await sql`
      WITH pts AS (
        SELECT ST_Transform(location, 3857) AS m, individual_count
        FROM species_observations
        ${whereObservations(sql, q)}
      ),
      ext AS (
        SELECT ST_SetSRID(ST_Expand(ST_Extent(m)::geometry, 1000), 3857) AS e,
          ST_Y(ST_Transform(ST_SetSRID(ST_Centroid(ST_Extent(m)::geometry), 3857), 4326)) AS lat
        FROM pts
      ),
      grid AS (
        -- Web Mercator inflates distances by 1/cos(lat); scale so cell_km is true ground size.
        SELECT (ST_HexagonGrid(${q.cell_km * 1000} / cos(radians(lat)), e)).*
        FROM ext WHERE e IS NOT NULL
      )
      SELECT ${geojson("ST_Transform(g.geom, 4326)")} AS geometry,
        count(*) AS sightings, sum(p.individual_count) AS individuals
      FROM grid g JOIN pts p ON ST_Intersects(g.geom, p.m)
      GROUP BY g.geom
    `;
    return {
      type: "FeatureCollection",
      cell_km: q.cell_km,
      max_sightings: rows.reduce((m, r) => Math.max(m, Number(r.sightings)), 0),
      features: rows.map(({ geometry, ...properties }) => ({ type: "Feature", geometry, properties })),
    };
  });

  /** Cumulative concave-hull frontier per time step, showing how an infestation spreads. */
  app.get("/analysis/invasive-frontier", async (req) => {
    const q = observationFilter.extend({ bucket: bucket.default("month"), pct: pctConvex }).parse(req.query);
    const filter = { ...q, invasive: q.species?.length ? q.invasive : (q.invasive ?? true) };
    const rows = await sql`
      WITH f AS (
        SELECT species_name, location, observed_at FROM species_observations
        ${whereObservations(sql, filter)}
      ),
      steps AS (
        SELECT DISTINCT species_name, date_trunc(${q.bucket}, observed_at) AS t FROM f
      )
      SELECT s.species_name, s.t AS bucket_start, h.n AS cumulative_sightings,
        ${geojson("h.hull")} AS geometry, ${areaKm2("h.hull")} AS area_sq_km
      FROM steps s
      CROSS JOIN LATERAL (
        SELECT count(*) AS n, ST_ConcaveHull(ST_Collect(f.location), ${q.pct}) AS hull
        FROM f
        WHERE f.species_name = s.species_name
          AND f.observed_at < s.t + ${"1 " + q.bucket}::interval
      ) h
      WHERE h.n >= 3
      ORDER BY s.species_name, s.t
    `;
    let prev: { species: string; area: number } | undefined;
    return {
      type: "FeatureCollection",
      bucket: q.bucket,
      features: rows.map(({ geometry, ...p }) => {
        const area = Number(p.area_sq_km);
        const growth = prev && prev.species === p.species_name ? area - prev.area : null;
        prev = { species: p.species_name, area };
        return { type: "Feature", geometry, properties: { ...p, growth_sq_km: growth } };
      }),
    };
  });
}
