// Integration tests: run against the dev database (`pnpm db:up && pnpm db:migrate`).
// Each test writes rows under a unique species name and removes them afterwards.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sql } from "../src/db.js";

const SPECIES = `Testus ${randomUUID().slice(0, 8)}`;
let app: FastifyInstance;

const point = (lon: number, lat: number, day: number, id = randomUUID()) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, species: SPECIES, timestamp: `2026-01-${String(day).padStart(2, "0")}T12:00:00Z` },
});

before(async () => {
  process.env.LOG_LEVEL = "silent";
  app = await buildApp();
});
after(async () => {
  await sql`DELETE FROM species_observations WHERE species_name = ${SPECIES}`;
  await app.close();
  await sql.end();
});

describe("POST /observations", () => {
  test("ingests a FeatureCollection and is idempotent on client ids", async () => {
    const fc = { type: "FeatureCollection", features: [point(35, -2, 1), point(35.1, -2, 2)] };
    const first = await app.inject({ method: "POST", url: "/observations", payload: fc });
    assert.equal(first.statusCode, 201);
    assert.equal(first.json().accepted.length, 2);

    const retry = await app.inject({ method: "POST", url: "/observations", payload: fc });
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json().accepted, []);
    assert.equal(retry.json().duplicates.length, 2);
  });

  test("rejects out-of-range coordinates", async () => {
    const res = await app.inject({ method: "POST", url: "/observations", payload: point(200, 0, 1) });
    assert.equal(res.statusCode, 400);
  });
});

describe("analysis", () => {
  before(async () => {
    // An L-shaped cluster: its concave hull must be clearly smaller than its MCP.
    const features = [];
    for (let i = 0; i <= 10; i++) features.push(point(35 + i * 0.01, -2, 3 + (i % 20)));
    for (let i = 0; i <= 10; i++) features.push(point(35, -2 + i * 0.01, 3 + (i % 20)));
    for (let i = 0; i <= 10; i++) features.push(point(35 + i * 0.01, -1.995, 3 + (i % 20)));
    for (let i = 0; i <= 10; i++) features.push(point(35.005, -2 + i * 0.01, 3 + (i % 20)));
    await app.inject({ method: "POST", url: "/observations", payload: { type: "FeatureCollection", features } });
  });

  test("concave home range is tighter than the minimum convex polygon", async () => {
    const res = await app.inject({ url: `/analysis/home-range?species=${encodeURIComponent(SPECIES)}&pct=0.2` });
    assert.equal(res.statusCode, 200);
    const [f] = res.json().features;
    assert.ok(f.properties.area_sq_km > 0);
    assert.ok(f.properties.area_sq_km < f.properties.mcp_area_sq_km * 0.6, JSON.stringify(f.properties));
  });

  test("convex method equals the MCP area", async () => {
    const res = await app.inject({ url: `/analysis/home-range?species=${encodeURIComponent(SPECIES)}&method=convex` });
    const [f] = res.json().features;
    assert.ok(Math.abs(f.properties.area_sq_km - f.properties.mcp_area_sq_km) < 1e-6);
  });

  test("trajectory returns displacement between chronological buckets", async () => {
    const res = await app.inject({ url: `/analysis/trajectory?species=${encodeURIComponent(SPECIES)}&bucket=day` });
    const [tr] = res.json().species;
    assert.equal(tr.steps[0].from_position, null);
    assert.ok(tr.steps.length > 1);
    assert.ok(tr.steps.slice(1).every((s: { distance_km: number }) => s.distance_km >= 0));
  });

  test("density bins every sighting into hex cells", async () => {
    const res = await app.inject({ url: `/analysis/density?species=${encodeURIComponent(SPECIES)}&cell_km=0.5` });
    const total = res.json().features.reduce((n: number, f: { properties: { sightings: number } }) => n + Number(f.properties.sightings), 0);
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM species_observations WHERE species_name = ${SPECIES}`;
    assert.equal(total, count);
  });

  test("compare returns 422 when a period has too few sightings", async () => {
    const q = new URLSearchParams({
      species: SPECIES,
      a_from: "2020-01-01T00:00:00Z",
      a_to: "2020-02-01T00:00:00Z",
      b_from: "2026-01-01T00:00:00Z",
      b_to: "2026-02-01T00:00:00Z",
    });
    const res = await app.inject({ url: `/analysis/home-range/compare?${q}` });
    assert.equal(res.statusCode, 422);
  });
});
