import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { sql, type Sql } from "../db.js";
import { corePercent, pctConvex } from "../schemas.js";

const iso = z.iso.datetime({ offset: true });
const range = z.object({ from: iso.optional(), to: iso.optional() });

/**
 * GPS-error screen (after Bjørneraas et al. 2010, J. Wildl. Manage.). A fix is an outlier if
 *  - both its inbound and outbound legs exceed `max_speed_kmh` (physically implausible), or
 *  - both legs exceed a third of that AND the path goes out and straight back: the
 *    previous and next fixes are close together relative to the legs. A real fast
 *    movement keeps going; a spike returns. Speed alone misses spikes when fixes are
 *    hours apart, because a 10 km error over 2 h looks like a plausible 5 km/h.
 * 15 km/h sustained over a fix interval is beyond elephants and wildebeest.
 */
const maxSpeed = z.coerce.number().positive().max(200).default(15);

interface Fix {
  id: string;
  t: number;
  lon: number;
  lat: number;
  hdop: number | null;
}

/**
 * Time-ordered fixes for one individual with an `outlier` flag, plus step distance and
 * speed recomputed over the cleaned (non-outlier) sequence.
 */
function screenedFixes(id: string, from: string | undefined, to: string | undefined, max: number) {
  return sql`
    WITH f AS (
      SELECT id, recorded_at, location, hdop FROM telemetry_fixes
      WHERE individual_id = ${id}
        ${from ? sql`AND recorded_at >= ${from}` : sql``}
        ${to ? sql`AND recorded_at < ${to}` : sql``}
    ),
    legs AS (
      SELECT *,
        ST_DistanceSphere(lag(location) OVER w, location) / 1000 AS km_in,
        ST_DistanceSphere(location, lead(location) OVER w) / 1000 AS km_out,
        ST_DistanceSphere(lag(location) OVER w, lead(location) OVER w) / 1000 AS km_skip,
        EXTRACT(EPOCH FROM recorded_at - lag(recorded_at) OVER w) / 3600 AS h_in,
        EXTRACT(EPOCH FROM lead(recorded_at) OVER w - recorded_at) / 3600 AS h_out
      FROM f WINDOW w AS (ORDER BY recorded_at)
    ),
    speeds AS (
      SELECT *, km_in / NULLIF(h_in, 0) AS speed_in, km_out / NULLIF(h_out, 0) AS speed_out FROM legs
    ),
    flagged AS (
      SELECT *,
        COALESCE(
          -- implausible speed on both legs (end fixes have one leg)
          ((speed_in IS NOT NULL OR speed_out IS NOT NULL)
            AND (speed_in IS NULL OR speed_in > ${max})
            AND (speed_out IS NULL OR speed_out > ${max}))
          -- fast out-and-back spike
          OR (speed_in > ${max / 3} AND speed_out > ${max / 3} AND km_skip < 0.2 * LEAST(km_in, km_out)),
          FALSE
        ) AS outlier
      FROM speeds
    ),
    clean_steps AS (
      SELECT id,
        ST_DistanceSphere(lag(location) OVER w, location) / 1000 AS step_km,
        EXTRACT(EPOCH FROM recorded_at - lag(recorded_at) OVER w) / 3600 AS step_h
      FROM flagged WHERE NOT outlier
      WINDOW w AS (ORDER BY recorded_at)
    )
    SELECT fl.id, fl.recorded_at, ST_X(fl.location) AS lon, ST_Y(fl.location) AS lat, fl.hdop, fl.outlier,
      cs.step_km, cs.step_h
    FROM flagged fl LEFT JOIN clean_steps cs USING (id)
    ORDER BY fl.recorded_at
  `;
}

const haversineKm = (a: Fix, b: Fix) => {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
};

/** Minimal CSV parser (RFC 4180 quoting), enough for Movebank exports. */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

const fixInput = z.object({
  t: iso,
  lon: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  hdop: z.number().nonnegative().nullish(),
});

/** Accepts Movebank column names (timestamp, location-long, location-lat, gps:hdop) or t/lon/lat/hdop. */
function fixFromCsv(r: Record<string, string>) {
  const raw = r["timestamp"] ?? r["t"] ?? "";
  // Movebank timestamps are UTC without a zone: "2026-06-01 10:00:00.000".
  const t = /[zZ]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const num = (v: string | undefined) => (v === undefined || v === "" ? undefined : Number(v));
  return {
    t: Number.isNaN(Date.parse(t)) ? raw : new Date(t).toISOString(),
    lon: num(r["location-long"] ?? r["lon"]),
    lat: num(r["location-lat"] ?? r["lat"]),
    hdop: num(r["gps:hdop"] ?? r["hdop"]) ?? null,
  };
}

export async function individualRoutes(app: FastifyInstance) {
  // Collared animals are prime poaching targets: telemetry is staff-only.
  app.addHook("onRequest", app.requireRole("ADMIN", "RESEARCHER", "RANGER"));
  const managers = { onRequest: [app.requireRole("ADMIN", "RESEARCHER")] };

  app.addContentTypeParser("text/csv", { parseAs: "string", bodyLimit: 50 * 1024 * 1024 }, (_req, body, done) =>
    done(null, body),
  );

  app.get("/individuals", async () => {
    return sql`
      SELECT i.id, i.code, i.name, i.species_name, i.sex, i.collar_id, i.notes,
        COALESCE(s.fixes, 0)::int AS fixes, s.first_fix, s.last_fix,
        CASE WHEN l.location IS NULL THEN NULL ELSE ARRAY[ST_X(l.location), ST_Y(l.location)] END AS last_position
      FROM individuals i
      LEFT JOIN (
        SELECT individual_id, count(*) AS fixes, min(recorded_at) AS first_fix, max(recorded_at) AS last_fix
        FROM telemetry_fixes GROUP BY individual_id
      ) s ON s.individual_id = i.id
      LEFT JOIN LATERAL (
        SELECT location FROM telemetry_fixes WHERE individual_id = i.id ORDER BY recorded_at DESC LIMIT 1
      ) l ON TRUE
      ORDER BY i.code
    `;
  });

  app.post("/individuals", managers, async (req, reply) => {
    const body = z
      .object({
        code: z.string().trim().min(1).max(32),
        species_name: z.string().trim().min(1).max(100),
        name: z.string().trim().max(100).nullish(),
        sex: z.enum(["F", "M", "U"]).default("U"),
        collar_id: z.string().trim().max(64).nullish(),
        notes: z.string().max(2000).nullish(),
      })
      .parse(req.body);
    try {
      const row = await sql.begin(async (txRaw) => {
        const tx = txRaw as unknown as Sql;
        await tx`INSERT INTO species (species_name) VALUES (${body.species_name}) ON CONFLICT DO NOTHING`;
        const [r] = await tx`
          INSERT INTO individuals (code, species_name, name, sex, collar_id, notes)
          VALUES (${body.code}, ${body.species_name}, ${body.name ?? null}, ${body.sex}, ${body.collar_id ?? null}, ${body.notes ?? null})
          RETURNING *
        `;
        await audit(tx, req.user.sub, "individual.create", body.code, { species: body.species_name });
        return r;
      });
      return reply.code(201).send(row);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") return reply.code(409).send({ error: `Code ${body.code} already exists` });
      throw err;
    }
  });

  /**
   * Imports collar fixes as JSON `{ fixes: [{t, lon, lat, hdop?}] }` or as CSV (text/csv,
   * Movebank columns). Fixes already stored for the same timestamp are skipped, so an
   * overlapping collar download can be re-imported safely.
   */
  app.post("/individuals/:id/fixes", managers, async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const [ind] = await sql`SELECT code FROM individuals WHERE id = ${id}`;
    if (!ind) return reply.code(404).send({ error: "Individual not found" });

    const candidates =
      typeof req.body === "string"
        ? parseCsv(req.body).map(fixFromCsv)
        : z.object({ fixes: z.array(z.unknown()).max(200_000) }).parse(req.body).fixes;

    const valid: z.infer<typeof fixInput>[] = [];
    const rejected: { row: number; reason: string }[] = [];
    candidates.forEach((c, i) => {
      const r = fixInput.safeParse(c);
      if (r.success) valid.push(r.data);
      else rejected.push({ row: i + 1, reason: r.error.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") });
    });

    let inserted = 0;
    for (let i = 0; i < valid.length; i += 5000) {
      const chunk = valid.slice(i, i + 5000);
      const res = await sql`
        INSERT INTO telemetry_fixes (individual_id, recorded_at, location, hdop)
        SELECT ${id}, r.t, ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326), r.hdop
        FROM jsonb_to_recordset(${sql.json(chunk)}::jsonb) AS r(t timestamptz, lon float8, lat float8, hdop real)
        ON CONFLICT (individual_id, recorded_at) DO NOTHING
      `;
      inserted += res.count;
    }
    if (inserted) await audit(sql, req.user.sub, "telemetry.import", ind.code, { inserted, rejected: rejected.length });
    return {
      inserted,
      duplicates: valid.length - inserted,
      rejected: rejected.length,
      rejected_rows: rejected.slice(0, 20),
    };
  });

  /** Track with outlier flags, per-step metrics and movement summary. */
  app.get("/individuals/:id/track", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = range.extend({ max_speed_kmh: maxSpeed }).parse(req.query);
    const [ind] = await sql`SELECT id, code, name, species_name FROM individuals WHERE id = ${id}`;
    if (!ind) return reply.code(404).send({ error: "Individual not found" });

    const rows = await screenedFixes(id, q.from, q.to, q.max_speed_kmh);
    const fixes = rows.map((r) => ({
      id: String(r.id),
      t: new Date(r.recorded_at).getTime(),
      lon: r.lon as number,
      lat: r.lat as number,
      hdop: r.hdop as number | null,
      outlier: r.outlier as boolean,
      step_km: r.step_km == null ? null : Number(r.step_km),
      speed_kmh: r.step_km == null || !r.step_h ? null : Number(r.step_km) / Number(r.step_h),
    }));

    const clean = fixes.filter((f) => !f.outlier);
    const totalKm = clean.reduce((s, f) => s + (f.step_km ?? 0), 0);
    const days = clean.length > 1 ? (clean[clean.length - 1].t - clean[0].t) / 86_400_000 : 0;
    const intervals = clean.slice(1).map((f, i) => (f.t - clean[i].t) / 3_600_000).sort((a, b) => a - b);
    const maxDisplacement = clean.reduce((m, f) => Math.max(m, haversineKm(clean[0], f)), 0);

    return {
      individual: ind,
      max_speed_kmh: q.max_speed_kmh,
      summary: {
        fixes: fixes.length,
        outliers: fixes.length - clean.length,
        first_fix: clean[0] ? new Date(clean[0].t) : null,
        last_fix: clean.length ? new Date(clean[clean.length - 1].t) : null,
        days: Math.round(days * 10) / 10,
        total_km: totalKm,
        km_per_day: days > 0 ? totalKm / days : null,
        median_interval_h: intervals.length ? intervals[Math.floor(intervals.length / 2)] : null,
        max_displacement_km: maxDisplacement,
      },
      fixes,
    };
  });

  /** Home range from cleaned fixes: hull at the requested core %, plus the 50% core area. */
  app.get("/individuals/:id/home-range", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = range
      .extend({ method: z.enum(["concave", "convex"]).default("convex"), pct: pctConvex, core: corePercent.default(95), max_speed_kmh: maxSpeed })
      .parse(req.query);
    const hull = (core: number) => sql`
      WITH pts AS (
        SELECT ST_SetSRID(ST_MakePoint(lon, lat), 4326) AS location
        FROM (${screenedFixes(id, q.from, q.to, q.max_speed_kmh)}) s WHERE NOT outlier
      ),
      ranked AS (
        SELECT location,
          percent_rank() OVER (ORDER BY ST_DistanceSphere(location, (SELECT ST_Centroid(ST_Collect(location)) FROM pts))) AS pr
        FROM pts
      ),
      core AS (SELECT ST_Collect(location) AS g, count(*) AS n FROM ranked WHERE pr <= ${core / 100})
      SELECT n, ${q.method === "convex" ? sql`ST_ConvexHull(g)` : sql`ST_ConcaveHull(g, ${q.pct})`} AS h FROM core
    `;
    const [row] = await sql`
      WITH main AS (${hull(q.core)}), core50 AS (${hull(50)})
      SELECT main.n::int AS fixes_used,
        ST_AsGeoJSON(main.h, 6)::json AS geometry,
        ST_Area(main.h::geography) / 1e6 AS area_sq_km,
        ST_AsGeoJSON(core50.h, 6)::json AS core50_geometry,
        ST_Area(core50.h::geography) / 1e6 AS core50_area_sq_km
      FROM main, core50
    `;
    if (!row || row.fixes_used < 3) return reply.code(422).send({ error: "Need at least 3 clean fixes in this range" });
    return { method: q.method, core_percent: q.core, ...row };
  });
}
