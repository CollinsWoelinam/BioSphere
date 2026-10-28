import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon, Geometry } from "geojson";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export interface Species {
  species_name: string;
  is_invasive: boolean;
  sightings: number;
  first_seen: string;
  last_seen: string;
  bbox: [number, number, number, number];
}

export interface ObservationProps {
  species: string;
  is_invasive: boolean;
  observer_type: "RANGER" | "CITIZEN";
  timestamp: string;
  accuracy_m: number | null;
  individual_count: number;
  habitat_notes: string | null;
}
export type Observation = Feature<Point, ObservationProps> & { id: string };

/** Observation flattened for rendering: parsed time + position. */
export interface Sighting extends ObservationProps {
  id: string;
  position: [number, number];
  t: number;
}

export interface HullProps {
  species_name: string;
  sightings: number;
  area_sq_km: number;
  perimeter_km: number;
  mcp_area_sq_km: number;
}

export interface TrajectoryStep {
  bucket_start: string;
  sightings: number;
  individuals: number;
  position: [number, number];
  from_position: [number, number] | null;
  distance_km: number | null;
  bearing_deg: number | null;
  speed_km_per_day: number | null;
}
export interface Trajectory {
  species_name: string;
  total_distance_km: number;
  steps: TrajectoryStep[];
}

export interface HullComparison {
  a_sightings: number;
  b_sightings: number;
  a_geometry: Geometry;
  b_geometry: Geometry;
  gained_geometry: Geometry;
  lost_geometry: Geometry;
  a_area_sq_km: number;
  b_area_sq_km: number;
  gained_sq_km: number;
  lost_sq_km: number;
  stable_sq_km: number;
  change_sq_km: number;
  change_percent: number | null;
}

export interface FrontierProps {
  species_name: string;
  bucket_start: string;
  cumulative_sightings: number;
  area_sq_km: number;
  growth_sq_km: number | null;
}

export interface Filter {
  species: string[];
  from?: string;
  to?: string;
}

function qs(params: Record<string, string | number | undefined | string[]>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || (Array.isArray(v) && !v.length)) continue;
    u.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return u.toString();
}

async function get<T>(path: string, params: Parameters<typeof qs>[0] = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}?${qs(params)}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  species: () => get<Species[]>("/species"),
  observations: (f: Filter, signal?: AbortSignal) =>
    get<FeatureCollection<Point, ObservationProps>>("/observations", { ...f }, signal),
  timeline: (f: Filter, bucket: "day" | "week" | "month") =>
    get<{ buckets: { bucket_start: string; sightings: number }[] }>("/observations/timeline", { ...f, bucket }),
  homeRange: (f: Filter, opts: { method: string; pct: number; core: number }) =>
    get<FeatureCollection<Polygon | MultiPolygon, HullProps>>("/analysis/home-range", { ...f, ...opts }),
  compare: (params: {
    species: string;
    a_from: string;
    a_to: string;
    b_from: string;
    b_to: string;
    method: string;
    pct: number;
    core: number;
  }) => get<HullComparison>("/analysis/home-range/compare", params),
  trajectory: (f: Filter, bucket: string) =>
    get<{ species: Trajectory[] }>("/analysis/trajectory", { ...f, bucket }),
  density: (f: Filter, cellKm: number, signal?: AbortSignal) =>
    get<FeatureCollection<Polygon, { sightings: number; individuals: number }> & { max_sightings: number }>(
      "/analysis/density",
      { ...f, cell_km: cellKm },
      signal,
    ),
  frontier: (f: Filter) =>
    get<FeatureCollection<Polygon | MultiPolygon, FrontierProps>>("/analysis/invasive-frontier", { ...f, bucket: "month" }),
  liveUrl: () => API_URL.replace(/^http/, "ws") + "/ws",
};

export function toSighting(f: Observation): Sighting {
  return {
    ...f.properties,
    id: f.id,
    position: f.geometry.coordinates as [number, number],
    t: Date.parse(f.properties.timestamp),
  };
}
