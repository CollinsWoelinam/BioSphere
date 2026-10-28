import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";
import type { ObservationFeature } from "./schemas.js";

export interface IngestResult {
  inserted: ObservationRow[];
  duplicateIds: string[];
}

/** Who submitted a batch. `null` (seed/import scripts) trusts each feature's observer_type. */
export interface Observer {
  id: string;
  observerType: "RANGER" | "CITIZEN";
}

export interface ObservationRow {
  id: string;
  species_name: string;
  is_invasive: boolean;
  observer_type: "RANGER" | "CITIZEN";
  lon: number;
  lat: number;
  accuracy_m: number | null;
  altitude_m: number | null;
  individual_count: number;
  habitat_notes: string | null;
  device_id: string | null;
  observed_at: Date;
  generalized?: boolean;
}

/**
 * Inserts observations in one statement. Rows whose id already exists are skipped,
 * so a mobile client can safely resend its offline queue after a dropped connection.
 *
 * The submitter's identity and observer type come from their account, never from
 * the request body. The species registry is authoritative for `is_invasive`; species
 * not yet in the registry are added with the submitted flag.
 */
export async function ingestObservations(
  sql: Sql,
  features: ObservationFeature[],
  observer: Observer | null,
): Promise<IngestResult> {
  const rows = features.map(({ geometry, properties: p }) => ({
    id: p.id ?? randomUUID(),
    species_name: p.species,
    is_invasive: p.is_invasive,
    observer_type: observer?.observerType ?? p.observer_type,
    observer_id: observer?.id ?? null,
    lon: geometry.coordinates[0],
    lat: geometry.coordinates[1],
    accuracy_m: p.accuracy_m ?? null,
    altitude_m: p.altitude_m ?? geometry.coordinates[2] ?? null,
    individual_count: p.individual_count,
    habitat_notes: p.habitat_notes ?? null,
    device_id: p.device_id ?? null,
    observed_at: p.timestamp,
  }));

  const inserted = await sql.begin(async (tx) => {
    await tx`
      INSERT INTO species (species_name, is_invasive)
      SELECT r.species_name, bool_or(r.is_invasive)
      FROM jsonb_to_recordset(${tx.json(rows)}::jsonb) AS r(species_name text, is_invasive boolean)
      GROUP BY r.species_name
      ON CONFLICT (species_name) DO NOTHING
    `;
    return tx<ObservationRow[]>`
      INSERT INTO species_observations (
        id, species_name, is_invasive, observer_type, observer_id, location, accuracy_m, altitude_m,
        individual_count, habitat_notes, device_id, observed_at
      )
      SELECT
        r.id, r.species_name, s.is_invasive, r.observer_type, r.observer_id,
        ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326), r.accuracy_m, r.altitude_m,
        r.individual_count, r.habitat_notes, r.device_id, r.observed_at
      FROM jsonb_to_recordset(${tx.json(rows)}::jsonb) AS r(
        id uuid, species_name text, is_invasive boolean, observer_type text, observer_id uuid,
        lon double precision, lat double precision, accuracy_m real, altitude_m real,
        individual_count integer, habitat_notes text, device_id text, observed_at timestamptz
      )
      JOIN species s USING (species_name)
      ON CONFLICT (id) DO NOTHING
      RETURNING id, species_name, is_invasive, observer_type,
        ST_X(location) AS lon, ST_Y(location) AS lat, accuracy_m, altitude_m,
        individual_count, habitat_notes, device_id, observed_at
    `;
  });

  const insertedIds = new Set(inserted.map((r) => r.id));
  return {
    inserted,
    duplicateIds: rows.map((r) => r.id).filter((id) => !insertedIds.has(id)),
  };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

export function toFeature(r: ObservationRow) {
  return {
    type: "Feature" as const,
    id: r.id,
    // Grid snapping leaves float noise (34.800000000000004); 6 dp is ~0.1 m.
    geometry: { type: "Point" as const, coordinates: [round6(r.lon), round6(r.lat)] },
    properties: {
      species: r.species_name,
      is_invasive: r.is_invasive,
      observer_type: r.observer_type,
      timestamp: r.observed_at,
      accuracy_m: r.accuracy_m,
      altitude_m: r.altitude_m,
      individual_count: r.individual_count,
      habitat_notes: r.habitat_notes,
      ...(r.generalized ? { generalized: true } : {}),
    },
  };
}
