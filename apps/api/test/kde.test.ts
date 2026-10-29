// Pure KDE tests: no database. Checks the estimator against closed-form expectations.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { kdeHomeRange } from "../src/kde.js";

// Seeded normal samples (mulberry32 + Box–Muller) so the tests are deterministic.
function normals(n: number, seed: number) {
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: n }, () => {
    const r = Math.sqrt(-2 * Math.log(1 - rand()));
    const a = 2 * Math.PI * rand();
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

const M_PER_DEG = 110_574; // close to the equator, lon and lat degrees are ~equal in metres

describe("KDE home range", () => {
  test("95% isopleth of a bivariate normal matches the analytic area", () => {
    // Samples from N(0, σ²I) with σ = 2 km; the KDE's expectation is N(0, (σ²+h²)I), whose
    // p-volume region is a disc of area −2π(σ²+h²)·ln(1−p).
    const sigmaM = 2000;
    const pts = normals(2000, 7).map(([x, y]) => ({ lon: 35 + (x * sigmaM) / M_PER_DEG, lat: -0.01 + (y * sigmaM) / M_PER_DEG }));
    const kde = kdeHomeRange(pts, { levels: [95, 50] })!;
    const s2 = (sigmaM ** 2 + kde.bandwidth_m ** 2) / 1e6; // km²
    const expected95 = -2 * Math.PI * s2 * Math.log(0.05);
    const expected50 = -2 * Math.PI * s2 * Math.log(0.5);
    const [k95, k50] = kde.isopleths;
    assert.ok(Math.abs(k95.area_sq_km / expected95 - 1) < 0.08, `95%: ${k95.area_sq_km} vs ${expected95}`);
    assert.ok(Math.abs(k50.area_sq_km / expected50 - 1) < 0.08, `50%: ${k50.area_sq_km} vs ${expected50}`);
  });

  test("bandwidth follows the reference rule and scales with hScale", () => {
    const pts = normals(500, 3).map(([x, y]) => ({ lon: 35 + x / 100, lat: y / 100 }));
    const ref = kdeHomeRange(pts)!.bandwidth_m;
    const half = kdeHomeRange(pts, { hScale: 0.5 })!.bandwidth_m;
    assert.ok(Math.abs(half / ref - 0.5) < 1e-9);
    // σ ≈ 0.01° ≈ 1.1 km; h_ref = σ·n^(-1/6) ≈ 1.1 km · 0.354 ≈ 0.39 km
    assert.ok(ref > 300 && ref < 500, String(ref));
  });

  test("two separated clusters give a two-part 50% core with nothing in the gap", () => {
    const a = normals(400, 11).map(([x, y]) => ({ lon: 34.9 + x * 0.01, lat: -1.4 + y * 0.01 }));
    const b = normals(400, 12).map(([x, y]) => ({ lon: 34.9 + x * 0.01, lat: -1.75 + y * 0.01 }));
    const kde = kdeHomeRange([...a, ...b], { hScale: 0.6 })!;
    const core = kde.isopleths.find((i) => i.level === 50)!;
    assert.equal(core.geometry.coordinates.length, 2, "core should be two separate polygons");
    // No core polygon may reach the midpoint latitude between the clusters.
    const lats = core.geometry.coordinates.flatMap((poly) => poly[0].map(([, lat]) => lat));
    const midGap = lats.filter((lat) => lat < -1.5 && lat > -1.65);
    assert.equal(midGap.length, 0);
  });

  test("returns null with too few or degenerate points", () => {
    assert.equal(kdeHomeRange([{ lon: 35, lat: -2 }]), null);
    assert.equal(kdeHomeRange(Array.from({ length: 10 }, () => ({ lon: 35, lat: -2 }))), null);
  });
});
