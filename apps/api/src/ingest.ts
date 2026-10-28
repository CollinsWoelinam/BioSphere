import { randomUUID } from "node:crypto";
import type { Sql } from "./db.js";
import type { ObservationFeature } from "./schemas.js";

export interface IngestResult {
  inserted: ObservationRow[];
  duplicateIds: string[];
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
}

/**
 * Inserts observations in one statement. Rows whose id already exists are skipped,
 * so a mobile client can safely resend its offline queue after a dropped connection.
 */
export async function ingestObservations(
  sql: Sql,
  features: ObservationFeature[],
): Promise<IngestResult> {
  const rows = features.map(({ geometry, properties: p }) => ({
    id: p.id ?? randomUUID(),
    species_name: p.species,
    is_invasive: p.is_invasive,
    observer_type: p.observer_type,
    lon: geometry.coordinates[0],
    lat: geometry.coordinates[1],
    accuracy_m: p.accuracy_m ?? null,
    altitude_m: p.altitude_m ?? geometry.coordinates[2] ?? null,
    individual_count: p.individual_count,
    habitat_notes: p.habitat_notes ?? null,
    device_id: p.device_id ?? null,
    observed_at: p.timestamp,
  }));

  const inserted = await sql<ObservationRow[]>`
    INSERT INTO species_observations (
      id, species_name, is_invasive, observer_type, location, accuracy_m, altitude_m,
      individual_count, habitat_notes, device_id, observed_at
    )
    SELECT
      r.id, r.species_name, r.is_invasive, r.observer_type,
      ST_SetSRID(ST_MakePoint(r.lon, r.lat), 4326), r.accuracy_m, r.altitude_m,
      r.individual_count, r.habitat_notes, r.device_id, r.observed_at
    FROM jsonb_to_recordset(${sql.json(rows)}::jsonb) AS r(
      id uuid, species_name text, is_invasive boolean, observer_type text,
      lon double precision, lat double precision, accuracy_m real, altitude_m real,
      individual_count integer, habitat_notes text, device_id text, observed_at timestamptz
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING id, species_name, is_invasive, observer_type,
      ST_X(location) AS lon, ST_Y(location) AS lat, accuracy_m, altitude_m,
      individual_count, habitat_notes, device_id, observed_at
  `;

  const insertedIds = new Set(inserted.map((r) => r.id));
  return {
    inserted,
    duplicateIds: rows.map((r) => r.id).filter((id) => !insertedIds.has(id)),
  };
}

export function toFeature(r: ObservationRow) {
  return {
    type: "Feature" as const,
    id: r.id,
    geometry: { type: "Point" as const, coordinates: [r.lon, r.lat] },
    properties: {
      species: r.species_name,
      is_invasive: r.is_invasive,
      observer_type: r.observer_type,
      timestamp: r.observed_at,
      accuracy_m: r.accuracy_m,
      altitude_m: r.altitude_m,
      individual_count: r.individual_count,
      habitat_notes: r.habitat_notes,
    },
  };
}
