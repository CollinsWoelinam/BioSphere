import type { Sql } from "./db.js";
import type { ObservationFilter } from "./schemas.js";

/** Builds the shared WHERE clause used by every observation and analysis query. */
export function whereObservations(sql: Sql, f: ObservationFilter) {
  return sql`
    WHERE TRUE
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
