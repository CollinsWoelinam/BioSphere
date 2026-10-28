import { seesExactLocations, type Viewer } from "./auth.js";
import { config } from "./config.js";
import type { Sql } from "./db.js";
import type { ObservationFilter } from "./schemas.js";

const isSensitive = (sql: Sql) =>
  sql`species_name IN (SELECT species_name FROM species WHERE is_sensitive)`;

/**
 * Shared WHERE clause for every observation and analysis query.
 *
 * `viewer` is required so no endpoint can forget the sensitive-species rule.
 * Viewers who may not see exact locations get sensitive species removed,
 * unless the caller passes `generalized: true` and selects `locationFor()`
 * instead of the raw `location` column.
 */
export function whereObservations(
  sql: Sql,
  f: ObservationFilter,
  viewer: Viewer,
  opts: { generalized?: boolean } = {},
) {
  return sql`
    WHERE TRUE
    ${!seesExactLocations(viewer) && !opts.generalized ? sql`AND NOT ${isSensitive(sql)}` : sql``}
    ${f.species?.length ? sql`AND species_name IN ${sql(f.species)}` : sql``}
    ${f.from ? sql`AND observed_at >= ${f.from}` : sql``}
    ${f.to ? sql`AND observed_at < ${f.to}` : sql``}
    ${
      f.bbox
        ? sql`AND location && ST_MakeEnvelope(${f.bbox[0]}, ${f.bbox[1]}, ${f.bbox[2]}, ${f.bbox[3]}, 4326)`
        : sql``
    }
    ${f.invasive !== undefined ? sql`AND is_invasive = ${f.invasive}` : sql``}
    ${f.observer_type ? sql`AND observer_type = ${f.observer_type}` : sql``}
  `;
}

/** Whether this row's location is generalised for the viewer. */
export function generalizedFor(sql: Sql, viewer: Viewer) {
  return seesExactLocations(viewer) ? sql`FALSE` : isSensitive(sql);
}

/** Location as the viewer may see it: sensitive species snap to a coarse grid. */
export function locationFor(sql: Sql, viewer: Viewer) {
  return seesExactLocations(viewer)
    ? sql`location`
    : sql`CASE WHEN ${isSensitive(sql)} THEN ST_SnapToGrid(location, ${config.sensitiveGridDeg}) ELSE location END`;
}

/** Throws 403 when the viewer asks to analyse a species whose locations they may not see. */
export async function assertMayAnalyse(sql: Sql, viewer: Viewer, species: string[] | undefined) {
  if (seesExactLocations(viewer) || !species?.length) return;
  const [hit] = await sql`SELECT 1 FROM species WHERE is_sensitive AND species_name IN ${sql(species)} LIMIT 1`;
  if (hit) {
    throw Object.assign(new Error("Spatial analysis of sensitive species is restricted to rangers and researchers"), {
      statusCode: 403,
    });
  }
}
