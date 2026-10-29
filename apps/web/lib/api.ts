import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon, Geometry } from "geojson";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export type Role = "ADMIN" | "RESEARCHER" | "RANGER" | "CITIZEN";
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}
export interface Session {
  token: string;
  user: SessionUser;
}

/** Citizens see sensitive species generalised and cannot analyse them. */
export const seesExactLocations = (u: SessionUser) => u.role !== "CITIZEN";

let token: string | null = null;
let onUnauthorized: () => void = () => {};

export function configureAuth(t: string | null, handler: () => void) {
  token = t;
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface Species {
  species_name: string;
  is_invasive: boolean;
  is_sensitive: boolean;
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
  /** True when the location was snapped to a coarse grid for this viewer. */
  generalized?: boolean;
  photo_count?: number;
}
export type Observation = Feature<Point, ObservationProps> & { id: string };

/** Observation flattened for rendering: parsed time + position. */
export interface Sighting extends ObservationProps {
  id: string;
  position: [number, number];
  t: number;
}

export interface Photo {
  id: string;
  width: number;
  height: number;
  created_at: string;
  url: string;
  thumb_url: string;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && token) onUnauthorized();
    throw new ApiError(body.error ?? `${res.status} ${res.statusText}`, res.status);
  }
  return res.json();
}

const get = <T,>(path: string, params: Parameters<typeof qs>[0] = {}, signal?: AbortSignal) =>
  request<T>(`${path}?${qs(params)}`, { signal });

export const auth = {
  login: (email: string, password: string) =>
    request<Session>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  register: (name: string, email: string, password: string) =>
    request<Session>("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }),
};

export interface Account extends SessionUser {
  disabled_at: string | null;
  created_at: string;
}
export interface RegistryEntry {
  species_name: string;
  is_invasive: boolean;
  is_sensitive: boolean;
  sightings: number;
  last_seen: string | null;
}
export interface AuditEntry {
  id: number;
  action: string;
  target: string;
  details: Record<string, unknown>;
  created_at: string;
  actor_email: string | null;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const admin = {
  users: () => request<Account[]>("/auth/users"),
  createUser: (u: { name: string; email: string; password: string; role: Role }) =>
    request<Account>("/auth/users", json("POST", u)),
  updateUser: (id: string, patch: { role?: Role; disabled?: boolean }) =>
    request<Account>(`/auth/users/${id}`, json("PATCH", patch)),
  species: () => request<RegistryEntry[]>("/admin/species"),
  updateSpecies: (name: string, patch: { is_invasive?: boolean; is_sensitive?: boolean }) =>
    request<RegistryEntry>(`/admin/species/${encodeURIComponent(name)}`, json("PUT", patch)),
  audit: () => request<AuditEntry[]>("/admin/audit?limit=200"),
};

export interface Individual {
  id: string;
  code: string;
  name: string | null;
  species_name: string;
  sex: "F" | "M" | "U";
  collar_id: string | null;
  fixes: number;
  first_fix: string | null;
  last_fix: string | null;
  last_position: [number, number] | null;
}
export interface TrackFix {
  id: string;
  t: number;
  lon: number;
  lat: number;
  hdop: number | null;
  outlier: boolean;
  step_km: number | null;
  speed_kmh: number | null;
}
export interface Track {
  individual: Pick<Individual, "id" | "code" | "name" | "species_name">;
  summary: {
    fixes: number;
    outliers: number;
    days: number;
    total_km: number;
    km_per_day: number | null;
    median_interval_h: number | null;
    max_displacement_km: number;
  };
  fixes: TrackFix[];
}
export type RangeMethod = "kde" | "convex";
export interface IndividualRange {
  method: RangeMethod;
  bandwidth_m?: number;
  core_percent: number;
  fixes_used: number;
  geometry: Geometry;
  area_sq_km: number;
  core50_geometry: Geometry;
  core50_area_sq_km: number;
}

export const telemetry = {
  individuals: () => request<Individual[]>("/individuals"),
  track: (id: string) => request<Track>(`/individuals/${id}/track`),
  homeRange: (id: string, method: RangeMethod) =>
    request<IndividualRange>(`/individuals/${id}/home-range?method=${method}&core=95`),
};

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
  photos: (observationId: string) => request<Photo[]>(`/observations/${observationId}/photos`),
  /** <img> cannot send the bearer token, so photos are fetched and shown as blob URLs. */
  photoBlobUrl: async (path: string) => {
    const res = await fetch(`${API_URL}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(`Photo unavailable (${res.status})`, res.status);
    return URL.createObjectURL(await res.blob());
  },
  liveUrl: () => `${API_URL.replace(/^http/, "ws")}/ws?token=${encodeURIComponent(token ?? "")}`,
};

export function toSighting(f: Observation): Sighting {
  return {
    ...f.properties,
    id: f.id,
    position: f.geometry.coordinates as [number, number],
    t: Date.parse(f.properties.timestamp),
  };
}
