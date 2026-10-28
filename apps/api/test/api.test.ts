// Integration tests: run against the dev database (`pnpm db:up && pnpm db:migrate`).
// Each run uses unique species/user names and removes everything it created.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Role } from "../src/auth.js";
import { buildApp } from "../src/app.js";
import { sql } from "../src/db.js";
import sharp from "sharp";
import { deletePhotoFiles } from "../src/photos.js";
import { createUser } from "../src/users.js";

const RUN = randomUUID().slice(0, 8);
const SPECIES = `Testus ${RUN}`;
const SENSITIVE = `Secretus ${RUN}`;
const PASSWORD = "test-password-123";
let app: FastifyInstance;
const tokens = {} as Record<Role, string>;

const point = (lon: number, lat: number, day: number, species = SPECIES, id = randomUUID()) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { id, species, timestamp: `2026-01-${String(day).padStart(2, "0")}T12:00:00Z` },
});

const photoIds: string[] = [];

async function login(email: string) {
  const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD } });
  return res.json().token as string;
}

/** Creates an extra throwaway account and returns its id and token. */
async function account(role: Role, label: string) {
  const email = `${label}-${RUN}@test.local`;
  const user = await createUser(sql, { email, name: label, role, password: PASSWORD });
  return { id: user.id, email, token: await login(email) };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Builds a multipart body by hand so tests need no extra dependency. */
function multipart(field: string, filename: string, data: Buffer, type = "image/jpeg") {
  const boundary = `----biosphere${RUN}`;
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { payload: body, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

/** A small JPEG carrying EXIF GPS tags, like a phone camera produces. */
const jpegWithGps = () =>
  sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 120, b: 60 } } })
    .withExif({
      IFD0: { Make: "TestCam", Model: "Field 1" },
      IFD3: { GPSLatitudeRef: "S", GPSLatitude: "2/1 44/1 3600/100", GPSLongitudeRef: "E", GPSLongitude: "34/1 46/1 5200/100" },
    })
    .jpeg()
    .toBuffer();

const as = (role: Role) => ({ authorization: `Bearer ${tokens[role]}` });
const get = (role: Role, url: string) => app.inject({ url, headers: as(role) });
const post = (role: Role, url: string, payload: unknown) => app.inject({ method: "POST", url, payload, headers: as(role) });

before(async () => {
  process.env.LOG_LEVEL = "silent";
  app = await buildApp();
  for (const role of ["ADMIN", "RANGER", "CITIZEN"] as Role[]) {
    const email = `${role.toLowerCase()}-${RUN}@test.local`;
    await createUser(sql, { email, name: role, role, password: PASSWORD });
    const res = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password: PASSWORD } });
    tokens[role] = res.json().token;
  }
  await sql`INSERT INTO species (species_name, is_sensitive) VALUES (${SENSITIVE}, TRUE)`;
});

after(async () => {
  await Promise.all(photoIds.map(deletePhotoFiles));
  await sql`DELETE FROM species_observations WHERE species_name IN (${SPECIES}, ${SENSITIVE})`;
  await sql`DELETE FROM species WHERE species_name IN (${SPECIES}, ${SENSITIVE})`;
  await sql`DELETE FROM users WHERE email LIKE ${"%-" + RUN + "@test.local"}`;
  await app.close();
  await sql.end();
});

describe("auth", () => {
  test("data endpoints require a token", async () => {
    assert.equal((await app.inject({ url: "/observations" })).statusCode, 401);
    assert.equal((await app.inject({ url: "/observations", headers: { authorization: "Bearer junk" } })).statusCode, 401);
  });

  test("wrong password is rejected", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: `ranger-${RUN}@test.local`, password: "nope" },
    });
    assert.equal(res.statusCode, 401);
  });

  test("self-registration always yields a CITIZEN, whatever role is requested", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { email: `self-${RUN}@test.local`, name: "Self", password: PASSWORD, role: "ADMIN" },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().user.role, "CITIZEN");
  });

  test("only admins can create staff accounts", async () => {
    const payload = { email: `staff-${RUN}@test.local`, name: "Staff", password: PASSWORD, role: "RANGER" };
    assert.equal((await post("CITIZEN", "/auth/users", payload)).statusCode, 403);
    assert.equal((await post("ADMIN", "/auth/users", payload)).statusCode, 201);
  });
});

describe("revocation", () => {
  test("logout-all invalidates existing tokens", async () => {
    const u = await account("RANGER", "logout");
    assert.equal((await app.inject({ url: "/auth/me", headers: bearer(u.token) })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/auth/logout-all", headers: bearer(u.token) })).statusCode, 204);
    assert.equal((await app.inject({ url: "/auth/me", headers: bearer(u.token) })).statusCode, 401);
    assert.equal((await app.inject({ url: "/auth/me", headers: bearer(await login(u.email)) })).statusCode, 200);
  });

  test("role changes apply immediately and disabling blocks sign-in", async () => {
    const u = await account("CITIZEN", "promote");
    const patch = (body: object) =>
      app.inject({ method: "PATCH", url: `/auth/users/${u.id}`, payload: body, headers: as("ADMIN") });

    assert.equal((await patch({ role: "RANGER" })).statusCode, 200);
    const fresh = await login(u.email); // the promotion revoked the old token
    const sensitive = await app.inject({ url: `/analysis/home-range?species=${encodeURIComponent(SENSITIVE)}`, headers: bearer(fresh) });
    assert.notEqual(sensitive.statusCode, 403);

    assert.equal((await patch({ disabled: true })).statusCode, 200);
    assert.equal((await app.inject({ url: "/auth/me", headers: bearer(fresh) })).statusCode, 401);
    const relogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: PASSWORD } });
    assert.equal(relogin.statusCode, 401);
  });

  test("admins cannot demote or disable themselves", async () => {
    const [me] = await sql`SELECT id FROM users WHERE email = ${`admin-${RUN}@test.local`}`;
    const res = await app.inject({ method: "PATCH", url: `/auth/users/${me.id}`, payload: { disabled: true }, headers: as("ADMIN") });
    assert.equal(res.statusCode, 409);
  });
});

describe("POST /observations", () => {
  test("ingests a FeatureCollection and is idempotent on client ids", async () => {
    const fc = { type: "FeatureCollection", features: [point(35, -2, 1), point(35.1, -2, 2)] };
    const first = await post("RANGER", "/observations", fc);
    assert.equal(first.statusCode, 201);
    assert.equal(first.json().accepted.length, 2);

    const retry = await post("RANGER", "/observations", fc);
    assert.equal(retry.statusCode, 200);
    assert.deepEqual(retry.json().accepted, []);
    assert.equal(retry.json().duplicates.length, 2);
  });

  test("observer type comes from the account, not the request body", async () => {
    const f = point(35, -2, 3);
    (f.properties as Record<string, unknown>).observer_type = "RANGER";
    await post("CITIZEN", "/observations", f);
    const [row] = await sql`SELECT observer_type, observer_id FROM species_observations WHERE id = ${f.properties.id}`;
    assert.equal(row.observer_type, "CITIZEN");
    assert.ok(row.observer_id);
  });

  test("rejects out-of-range coordinates", async () => {
    assert.equal((await post("RANGER", "/observations", point(200, 0, 1))).statusCode, 400);
  });
});

describe("sensitive species", () => {
  before(async () => {
    const features = [0, 1, 2, 3, 4].map((i) => point(34.7812 + i * 0.003, -2.7433 - i * 0.002, 1 + i, SENSITIVE));
    (features[0].properties as Record<string, unknown>).habitat_notes = "At the north waterhole";
    await post("RANGER", "/observations", { type: "FeatureCollection", features });
  });

  test("rangers see exact locations", async () => {
    const res = await get("RANGER", `/observations?species=${encodeURIComponent(SENSITIVE)}`);
    const f = res.json().features;
    assert.equal(f.length, 5);
    assert.equal(f[0].geometry.coordinates[0], 34.7812);
    assert.equal(f[0].properties.habitat_notes, "At the north waterhole");
  });

  test("citizens see grid-snapped locations with notes and accuracy removed", async () => {
    const res = await get("CITIZEN", `/observations?species=${encodeURIComponent(SENSITIVE)}`);
    const f = res.json().features;
    const exact = (await get("RANGER", `/observations?species=${encodeURIComponent(SENSITIVE)}`)).json().features;
    assert.equal(f.length, 5);
    for (const [i, x] of f.entries()) {
      for (const [k, c] of x.geometry.coordinates.entries()) {
        assert.ok(Math.abs(c * 10 - Math.round(c * 10)) < 1e-9, `${c} is not on the 0.1° grid`);
        assert.ok(Math.abs(c - exact[i].geometry.coordinates[k]) <= 0.05 + 1e-9, "snapped to the nearest cell");
      }
      assert.equal(x.properties.generalized, true);
      assert.equal(x.properties.habitat_notes, null);
      assert.equal(x.properties.accuracy_m, null);
    }
  });

  test("citizens cannot run spatial analyses on sensitive species", async () => {
    const q = `species=${encodeURIComponent(SENSITIVE)}`;
    for (const path of ["/analysis/home-range", "/analysis/trajectory", "/analysis/density"]) {
      assert.equal((await get("CITIZEN", `${path}?${q}`)).statusCode, 403, path);
    }
    assert.equal((await get("RANGER", `/analysis/home-range?${q}`)).statusCode, 200);
  });
});

describe("photos", () => {
  const obsId = randomUUID();
  const rhinoId = randomUUID();

  before(async () => {
    await post("RANGER", "/observations", {
      type: "FeatureCollection",
      features: [point(35, -2, 9, SPECIES, obsId), point(34.78, -2.74, 9, SENSITIVE, rhinoId)],
    });
  });

  const upload = (role: Role, observation: string, photoId: string, data: Buffer, type?: string) => {
    photoIds.push(photoId);
    const mp = multipart("photo", "field.jpg", data, type);
    return app.inject({ method: "PUT", url: `/observations/${observation}/photos/${photoId}`, payload: mp.payload, headers: { ...mp.headers, ...as(role) } });
  };

  test("upload strips EXIF (including GPS) and is idempotent", async () => {
    const original = await jpegWithGps();
    assert.ok((await sharp(original).metadata()).exif, "fixture should carry EXIF");

    const photoId = randomUUID();
    const first = await upload("RANGER", obsId, photoId, original);
    assert.equal(first.statusCode, 201);
    assert.equal(first.json().width, 640);

    const retry = await upload("RANGER", obsId, photoId, original);
    assert.equal(retry.statusCode, 200);

    const stored = await get("RANGER", `/photos/${photoId}`);
    assert.equal(stored.statusCode, 200);
    assert.equal(stored.headers["content-type"], "image/jpeg");
    const meta = await sharp(stored.rawPayload).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.width, 640);

    const thumb = await sharp((await get("RANGER", `/photos/${photoId}?size=thumb`)).rawPayload).metadata();
    assert.ok(thumb.width! <= 400);

    const listed = await get("CITIZEN", `/observations/${obsId}/photos`);
    assert.equal(listed.json().length, 1);
    const obs = (await get("RANGER", `/observations?species=${encodeURIComponent(SPECIES)}`)).json().features;
    assert.equal(obs.find((f: { id: string }) => f.id === obsId).properties.photo_count, 1);
  });

  test("only the observer can upload", async () => {
    assert.equal((await upload("CITIZEN", obsId, randomUUID(), await jpegWithGps())).statusCode, 403);
  });

  test("non-images are rejected", async () => {
    assert.equal((await upload("RANGER", obsId, randomUUID(), Buffer.from("not an image"), "image/jpeg")).statusCode, 415);
  });

  test("citizens cannot see photos of sensitive species", async () => {
    const photoId = randomUUID();
    assert.equal((await upload("RANGER", rhinoId, photoId, await jpegWithGps())).statusCode, 201);
    assert.equal((await get("CITIZEN", `/photos/${photoId}`)).statusCode, 403);
    assert.equal((await get("CITIZEN", `/observations/${rhinoId}/photos`)).statusCode, 403);
    assert.equal((await get("RANGER", `/photos/${photoId}`)).statusCode, 200);
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
    await post("RANGER", "/observations", { type: "FeatureCollection", features });
  });

  test("concave home range is tighter than the minimum convex polygon", async () => {
    const res = await get("RANGER", `/analysis/home-range?species=${encodeURIComponent(SPECIES)}&pct=0.2`);
    assert.equal(res.statusCode, 200);
    const [f] = res.json().features;
    assert.ok(f.properties.area_sq_km > 0);
    assert.ok(f.properties.area_sq_km < f.properties.mcp_area_sq_km * 0.6, JSON.stringify(f.properties));
  });

  test("convex method equals the MCP area", async () => {
    const res = await get("RANGER", `/analysis/home-range?species=${encodeURIComponent(SPECIES)}&method=convex`);
    const [f] = res.json().features;
    assert.ok(Math.abs(f.properties.area_sq_km - f.properties.mcp_area_sq_km) < 1e-6);
  });

  test("trajectory returns displacement between chronological buckets", async () => {
    const res = await get("RANGER", `/analysis/trajectory?species=${encodeURIComponent(SPECIES)}&bucket=day`);
    const [tr] = res.json().species;
    assert.equal(tr.steps[0].from_position, null);
    assert.ok(tr.steps.length > 1);
    assert.ok(tr.steps.slice(1).every((s: { distance_km: number }) => s.distance_km >= 0));
  });

  test("density bins every sighting into hex cells", async () => {
    const res = await get("RANGER", `/analysis/density?species=${encodeURIComponent(SPECIES)}&cell_km=0.5`);
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
    assert.equal((await get("RANGER", `/analysis/home-range/compare?${q}`)).statusCode, 422);
  });
});
