/**
 * Deterministic synthetic dataset for the Greater Serengeti–Mara ecosystem.
 * Re-running replaces previous seed rows (device_id = 'seed') and leaves real data alone.
 */
import { sql } from "./db.js";
import { ingestObservations } from "./ingest.js";
import type { ObservationFeature } from "./schemas.js";

// mulberry32: small seeded PRNG so every run produces the same dataset.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20261028);
const gauss = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

const START = Date.UTC(2025, 10, 1); // 2025-11-01
const DAYS = 360;
const DAY_MS = 86_400_000;

type LonLat = [number, number];
const features: ObservationFeature[] = [];

function add(species: string, [lon, lat]: LonLat, dayOffset: number, opts: Partial<ObservationFeature["properties"]> = {}) {
  const t = new Date(START + dayOffset * DAY_MS + rand() * DAY_MS);
  features.push({
    type: "Feature",
    geometry: { type: "Point", coordinates: [round(lon), round(lat)] },
    properties: {
      species,
      is_invasive: false,
      observer_type: rand() < 0.7 ? "RANGER" : "CITIZEN",
      timestamp: t.toISOString(),
      accuracy_m: Math.round((3 + rand() * 12) * 10) / 10,
      individual_count: 1,
      device_id: "seed",
      ...opts,
    },
  });
}
const round = (x: number) => Math.round(x * 1e6) / 1e6;

/** Linear interpolation along a closed loop of waypoints, f in [0, 1). */
function alongLoop(points: LonLat[], f: number): LonLat {
  const seg = f * points.length;
  const i = Math.floor(seg) % points.length;
  const a = points[i];
  const b = points[(i + 1) % points.length];
  const k = seg - Math.floor(seg);
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

// 1. Blue wildebeest – the clockwise Great Migration loop, starting November (eastern Serengeti).
const migrationLoop: LonLat[] = [
  [35.25, -2.2], // Nov – moving south through eastern Serengeti
  [35.15, -2.75], // Dec–Jan – Ndutu short-grass calving plains
  [35.0, -3.0], // Feb – calving peak
  [34.75, -2.75], // Mar–Apr – heading north-west
  [34.45, -2.35], // May – western corridor
  [34.15, -2.2], // Jun – Grumeti river crossings
  [34.6, -1.85], // Jul – northbound
  [35.05, -1.45], // Aug – Mara river crossings
  [35.15, -1.55], // Sep – Mara plains
  [35.35, -1.85], // Oct – returning south
];
for (let day = 0; day < DAYS; day++) {
  const centre = alongLoop(migrationLoop, day / DAYS);
  const n = 3 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    add("Connochaetes taurinus", [centre[0] + gauss() * 0.09, centre[1] + gauss() * 0.07], day, {
      individual_count: 20 + Math.floor(rand() * 500),
    });
  }
}

// 2. Plains zebra – travels ahead of the wildebeest herds (~2 weeks phase lead), wider spread.
for (let day = 0; day < DAYS; day += 2) {
  const centre = alongLoop(migrationLoop, ((day + 14) / DAYS) % 1);
  for (let i = 0; i < 3; i++) {
    add("Equus quagga", [centre[0] + gauss() * 0.13, centre[1] + gauss() * 0.1], day, {
      individual_count: 5 + Math.floor(rand() * 120),
    });
  }
}

// 3. African elephant – resident crescent-shaped range along the Mara river and Oloololo escarpment.
//    The empty interior shows how a concave hull avoids MCP's over-estimation.
for (let i = 0; i < 700; i++) {
  const theta = (-0.35 + rand() * 1.45) * Math.PI;
  const r = 0.28 + gauss() * 0.025;
  add("Loxodonta africana", [35.0 + r * Math.cos(theta), -1.45 + r * 0.8 * Math.sin(theta)], Math.floor(rand() * DAYS), {
    individual_count: 1 + Math.floor(rand() * 18),
  });
}

// 4. Lion – three pride territories around Seronera, a gradual northward drift through the dry season.
const prides: LonLat[] = [
  [34.83, -2.45],
  [34.95, -2.32],
  [34.7, -2.55],
];
for (let day = 0; day < DAYS; day += 1) {
  if (rand() > 0.6) continue;
  const p = pick(prides);
  const drift = Math.sin((day / DAYS) * Math.PI) * 0.04;
  add("Panthera leo", [p[0] + gauss() * 0.035, p[1] + drift + gauss() * 0.03], day, {
    individual_count: 1 + Math.floor(rand() * 8),
  });
}

// 5. Lantana camara (invasive) – radial spread from a lodge garden near Seronera.
//    Most detections sit on the advancing front, as ranger surveys do in practice.
const lantanaOrigin: LonLat = [34.88, -2.4];
for (let day = 0; day < DAYS; day++) {
  const radius = 0.01 + 0.17 * Math.pow(day / DAYS, 1.3);
  const n = 1 + Math.floor(rand() * 3);
  for (let i = 0; i < n; i++) {
    const theta = rand() * 2 * Math.PI;
    // Spread is faster downhill towards the south-west (wind/water dispersal).
    const bias = 1 + 0.5 * Math.cos(theta - 1.25 * Math.PI);
    const r = radius * bias * (rand() < 0.75 ? 0.85 + rand() * 0.15 : rand());
    add("Lantana camara", [lantanaOrigin[0] + r * Math.cos(theta), lantanaOrigin[1] + r * Math.sin(theta)], day, {
      is_invasive: true,
      individual_count: 1 + Math.floor(rand() * 40),
      habitat_notes: rand() < 0.1 ? "Dense thicket along drainage line" : null,
    });
  }
}

// 6. Parthenium hysterophorus (invasive) – linear spread along the Sekenani–Talek road corridor.
const roadStart: LonLat = [35.33, -1.58];
const roadEnd: LonLat = [34.93, -1.38];
for (let day = 0; day < DAYS; day++) {
  if (rand() > 0.7) continue;
  const reach = Math.min(1, 0.05 + day / DAYS);
  const k = rand() * reach;
  const lon = roadStart[0] + (roadEnd[0] - roadStart[0]) * k;
  const lat = roadStart[1] + (roadEnd[1] - roadStart[1]) * k;
  add("Parthenium hysterophorus", [lon + gauss() * 0.012, lat + gauss() * 0.012], day, {
    is_invasive: true,
    individual_count: 1 + Math.floor(rand() * 200),
    habitat_notes: rand() < 0.15 ? "Roadside verge, disturbed soil" : null,
  });
}

async function seed() {
  const deleted = await sql`DELETE FROM species_observations WHERE device_id = 'seed'`;
  let inserted = 0;
  for (let i = 0; i < features.length; i += 1000) {
    const result = await ingestObservations(sql, features.slice(i, i + 1000));
    inserted += result.inserted.length;
  }
  console.log(`removed ${deleted.count} old seed rows, inserted ${inserted} observations`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
