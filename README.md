# BioSphere

**Spatial Ecology, Migration Tracking & Conservation Intelligence System**

A monorepo with three parts that share one PostGIS database:

| Part | Path | Stack |
| --- | --- | --- |
| Core engine (API) | [`apps/api`](apps/api) | Fastify 5 + TypeScript, PostgreSQL 17 / PostGIS 3.5 (GEOS 3.14), Zod |
| Research portal | [`apps/web`](apps/web) | Next.js 16, deck.gl 9, MapLibre GL 6 |
| Field app | [`apps/mobile`](apps/mobile) | Flutter 3.41, flutter_map + MBTiles, sqflite |

```
 BioSphere Field (Flutter)                 BioSphere Portal (Next.js)
 ─ offline MBTiles basemap                 ─ temporal migration animator
 ─ precision GPS tagging                   ─ concave / MCP home-range hulls
 ─ SQLite queue + idempotent sync          ─ KDE heatmap, hex density, invasive frontier
 ─ offline ID guide                        ─ habitat change (period A vs B)
            │  REST (GeoJSON)                    │  REST + WebSocket (live sightings)
            └──────────────┐      ┌──────────────┘
                           ▼      ▼
                 Fastify API  (apps/api)
                           │  every analysis is one PostGIS query
                           ▼
           PostgreSQL + PostGIS (GiST + composite indexes)
```

## Quick start

Requirements: Docker, Node 22+ with pnpm, and Flutter 3.41+ for the mobile app.

```bash
pnpm install
pnpm db:up          # PostGIS on localhost:5544
pnpm db:migrate
pnpm db:seed        # ~4,100 synthetic Serengeti–Mara sightings + demo accounts
pnpm dev:api        # http://localhost:4000
pnpm dev:web        # http://localhost:3000
```

The seed creates one development account per role, all with the password `biosphere-dev`: `admin@`, `researcher@`, `ranger@` and `citizen@biosphere.local`. Sign in as `ranger@` and then as `citizen@` to compare how the black rhino appears to each.

Mobile app (start an emulator or connect a device first):

```bash
cd apps/mobile
flutter run         # Android emulator → API at http://10.0.2.2:4000 (editable in Settings)
```

Tests:

```bash
pnpm --filter @biosphere/api test   # integration tests against the dev database
cd apps/mobile && flutter test      # model + offline-sync unit tests
```

## Tool choices (and where they differ from the original spec)

| Spec | Chosen | Why |
| --- | --- | --- |
| Node.js *or* FastAPI | **Fastify + TypeScript** | API and portal share one language and one pnpm workspace. The heavy spatial work happens in PostGIS, so Python's GIS libraries aren't needed in the request path. |
| Mapbox GL JS / Deck.gl | **MapLibre GL + deck.gl** | MapLibre is the open-source fork of Mapbox GL: no access token, no per-load billing. deck.gl handles large point sets and animation on the GPU. |
| KDE heatmap | **deck.gl `HeatmapLayer`** (GPU Gaussian KDE) **+ server hex binning** (`ST_HexagonGrid`) | KDE re-renders every animation frame on the client. Hex counts are exact and scale to millions of rows server-side. |
| Turf.js / GDAL | **PostGIS for all analysis** | Hulls, areas (geodesic, via `::geography`), differences and grids run in the database next to the indexes. GDAL is still the recommended way to *produce* MBTiles (see below). |
| `postgis/postgis` image | **`postgis/postgis:17-3.5-alpine`** | The Debian image ships GEOS 3.9. `ST_ConcaveHull` only uses GEOS's much better native algorithm from GEOS 3.11, and the Alpine image has GEOS 3.14. |
| Mobile SQLite queue | **sqflite + client-generated UUIDs** | The server upserts with `ON CONFLICT (id) DO NOTHING`, so a retried batch can never create duplicate sightings. |

## Accounts and sensitive species

Every endpoint except `/health` and `/auth/*` needs a bearer token (JWT). The live WebSocket takes the token as `?token=`, because browsers can't set headers on a WebSocket.

| Role | Created by | Can do |
| --- | --- | --- |
| `CITIZEN` | Self-registration (`POST /auth/register`) | Log sightings. Sees sensitive species only at ~11 km resolution, and can't run analyses on them. |
| `RANGER` | Admin | Log sightings; see exact locations; run every analysis |
| `RESEARCHER` | Admin | Same as ranger |
| `ADMIN` | Admin or CLI | Everything, plus `POST /auth/users` to issue staff accounts |

- **Sensitive species** have `is_sensitive` set in the `species` table: the black rhino, white rhino and Temminck's pangolin, which are poaching targets. For citizens these sightings:
  - snap to a 0.1° grid (`SENSITIVE_GRID_DEG`), with accuracy and habitat notes removed, in REST responses, `/species` extents and live WebSocket pushes;
  - are left out of hulls, trajectories, density and frontiers, because a hull would reveal the range;
  - return a 403 if requested by name in an analysis.
- **Identity comes from the account.** `observer_type` and `observer_id` are set from the token, never from the request body, and the species registry decides whether a sighting counts as invasive.
- **Long-lived tokens.** Tokens last 30 days by default (`JWT_TTL`), so rangers can work offline for long stretches. If a token expires mid-trip, the field app keeps its queue and asks the user to sign in again before uploading.
- **Revocation.** Tokens carry only the user id and a `token_version`. The account is loaded on every request, so:
  - role changes apply immediately;
  - disabled accounts are rejected straight away;
  - `POST /auth/logout-all`, or an admin role change or disable, invalidates every outstanding token for that user.
- **Rate limits.** `/auth/login` and `/auth/register` allow 10 requests per minute per IP. Passwords are hashed with scrypt.

To create staff accounts from the terminal:

```bash
pnpm --filter @biosphere/api user:create -- --email ana@park.org --name "Ana M." --role RANGER
# prints a generated password unless --password is given
```

### Admin console

Admins have an **Admin** link in the portal sidebar, which opens `/admin`. It has three tabs:
- **Accounts:** create staff accounts, change roles, and disable or re-enable users. Role changes and disabling sign the user out everywhere.
- **Species registry:** toggle invasive and sensitive. You can also mark a species sensitive *before* its first sighting is recorded. Turning protection off asks for confirmation. Changing the invasive flag also updates that species' existing sightings.
- **Audit log:** every account and registry change, with who made it and the before/after values.

For production, set `NODE_ENV=production` and a strong `JWT_SECRET` (`openssl rand -base64 48`). The API refuses to start without the secret, and the seed script refuses to run.

## Photos

The field app uploads photos after their sighting is accepted, using `PUT` with a client-generated photo id so retries are safe. Before anything is stored, the API re-encodes every upload with `sharp`:
- It auto-rotates the image, caps it at 2400 px and saves it as JPEG.
- It drops **all metadata**. EXIF GPS would otherwise reveal exactly the locations that grid snapping hides. Camera serial numbers go too.
- It rejects anything that doesn't decode as an image (415), whatever content type was claimed.

Citizens can't view photos of sensitive species at all, because a photo's background can identify the place. The portal shows photos in a sighting detail panel when you click a point.

### Storage backends (`PHOTO_STORAGE`)

| Backend | Setting | Notes |
| --- | --- | --- |
| Local disk | `PHOTO_STORAGE=local` (default) | Files go under `PHOTO_DIR` (default `apps/api/data/photos`, git-ignored), with a pre-rendered 400 px thumbnail. Suits development and a single server. |
| Cloudinary | `PHOTO_STORAGE=cloudinary` + `CLOUDINARY_URL` | Photos are uploaded as **`authenticated`** assets under `CLOUDINARY_FOLDER` (default `biosphere/photos`), and thumbnails are a Cloudinary transformation. |

With Cloudinary, browsers never receive Cloudinary URLs:
- The API checks permissions, then fetches the image server-side through a signed URL and streams it to the browser.
- Signed delivery URLs don't expire on standard Cloudinary plans, so passing them to browsers would turn any leaked link to a rhino photo into a permanent one.
- Because the API sits in the middle, the same access rules apply whichever backend is used.

To switch an existing deployment from local disk to Cloudinary:

```bash
# CLOUDINARY_URL is under Cloudinary console → Settings → API Keys
echo 'CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>' >> apps/api/.env
pnpm --filter @biosphere/api photos:to-cloudinary   # copies existing photos; safe to re-run
# then set PHOTO_STORAGE=cloudinary in apps/api/.env and restart the API
```

The API refuses to start with `PHOTO_STORAGE=cloudinary` and no `CLOUDINARY_URL`. When Cloudinary is unreachable, photo requests return 502 and the rest of the API keeps working.

## Collared animals (GPS telemetry)

Individually identified animals live in `individuals`, and their collar fixes in `telemetry_fixes`. Fixes are kept apart from `species_observations`. A collar logs every hour or two whether or not anyone sees the animal, so mixing the two would swamp species heatmaps and hulls with a few animals' paths.

- **Staff only.** Collared animals are prime poaching targets, so citizens get 403 on every `/individuals` route. Admins and researchers create individuals and import fixes; rangers can view them.
- **Import.** `POST /individuals/:id/fixes` accepts Movebank CSV (`timestamp, location-long, location-lat, gps:hdop`; send `Content-Type: text/csv`) or JSON `{fixes: [{t, lon, lat, hdop}]}`.
  - Fixes are unique per (animal, time), so overlapping collar downloads can be re-imported safely.
  - Invalid rows are rejected and reported, without failing the whole import.
- **GPS-error screen** (after Bjørneraas et al. 2010). A fix is an outlier if both its legs exceed `max_speed_kmh` (default 15), or if both legs are fast and the path goes out and straight back. Speed alone misses spikes at long fix intervals: a 10 km error over 2 h looks like a plausible 5 km/h. Small errors of a few km are indistinguishable from real movement at 2-hour fixes, so they pass.
- **`GET /individuals/:id/track`** returns each fix with its outlier flag, step distance and speed, plus a summary: total km, km/day, median fix interval, maximum displacement from the first fix, and outliers removed.
- **`GET /individuals/:id/home-range`** returns the range at the requested `core` % (default 95) plus the 50% core, computed from clean fixes:
  - **`method=kde` (default):** a fixed-kernel utilisation distribution (Worton 1989), with isopleths drawn by marching squares (`d3-contour`).
    - Bandwidth is the reference *h*ref × `h_scale` (default 1). *h*ref oversmooths multimodal ranges; 0.5–0.8 is common in the literature.
    - The response includes `bandwidth_m`.
    - Areas are the summed grid cells inside each isopleth.
    - Tests check the 95% and 50% areas against the closed form for a bivariate normal; it agrees within 1–5% depending on sample size.
  - **`method=convex` / `concave`:** MCP or concave hull of the `core`% fixes nearest the centroid. It's comparable with older studies, but for an animal using two areas it puts the "core" in the empty gap between them.
  - On the seed data, E-023's KDE 50% core is two patches (338 km²), where MCP draws one 666 km² band across the corridor. For single-area E-017, the two methods agree (159 vs 155 km² at 95%).
  - KDE assumes independent fixes. Regular collar fixes are autocorrelated, which mostly affects bandwidth selection rather than the isopleth shape.

In the portal, staff see a **Collared animals** sidebar section:
- Ticking an animal flies the map to its track and shows its movement stats.
- Trails follow the time cursor and window, so playback animates them alongside sightings.
- Each animal's code is labelled at its latest position, because two animals can share a species colour.
- You can show each animal's 95% home range with its shaded 50% core, as KDE (default) or MCP, and show the rejected GPS fixes as rings.

`pnpm db:seed` adds three animals with two-hourly fixes for June–October 2026: E-017 (resident elephant), E-023 (elephant that shifts range mid-season) and W-104 (migrating wildebeest).

## Data model

[`db/migrations/001_init.sql`](db/migrations/001_init.sql) contains the spec's `species_observations` table plus a few field-data columns:

- `accuracy_m` and `altitude_m`: GPS quality, so analyses can filter out coarse fixes.
- `individual_count`: herd size. It weights the heatmap and density layers.
- `habitat_notes` and `device_id`.
- `observer_id`: the account that submitted the sighting. It links to `users`, and the [`species`](db/migrations/002_auth_species.sql) registry holds the invasive and sensitive flags.
- A WGS84 range check on `location`.

Indexes: GiST on `location`, `(species_name, observed_at)` for trajectories, and `observed_at` for the time slider.

## API

All list endpoints accept these filters: `species` (comma-separated), `from` and `to` (ISO-8601), `bbox=minLon,minLat,maxLon,maxLat`, `invasive=true|false` and `observer_type`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/observations` | Ingest a GeoJSON `Feature` or `FeatureCollection` (≤ 2000). Returns `{accepted, duplicates}`. Idempotent on `properties.id`. |
| `GET` | `/observations` | Sightings as a GeoJSON FeatureCollection, ordered by time. |
| `GET` | `/observations/timeline?bucket=day\|week\|month` | Counts per time bucket. |
| `GET` | `/species` | Species with counts, first and last seen, and bbox. |
| `GET` | `/analysis/home-range?method=concave\|convex&pct=0.7&core=95` | Hull per species, with geodesic area, perimeter and the MCP area for comparison. `core` drops the farthest outliers first (core=95 gives the standard MCP95). |
| `GET` | `/analysis/home-range/compare?species&a_from&a_to&b_from&b_to` | Habitat expansion or contraction: both hulls, plus gained, lost and stable polygons and their km². |
| `GET` | `/analysis/trajectory?bucket=week` | Chronological centroid per bucket, with distance, bearing and speed from the previous bucket. |
| `GET` | `/analysis/density?cell_km=3` | Hexagonal bins with true ground-size cells (corrected for Web Mercator scale). |
| `GET` | `/analysis/invasive-frontier?bucket=month` | Cumulative concave-hull frontier per month and its growth in km². |
| `WS` | `/ws` | Pushes `observations.created` events when sightings are ingested. The portal shows them live. |
| `GET` | `/health` | Liveness check, including the PostGIS and GEOS versions (public). |
| `POST` | `/auth/login` · `/auth/register` | Returns `{token, user}`. Register always creates a `CITIZEN` (public, rate-limited). |
| `GET` | `/auth/me` | The signed-in account. |
| `GET` · `PUT` | `/admin/species[/:name]` | Admin only: the species registry, and create/update `is_invasive` / `is_sensitive` (audited). |
| `GET` | `/admin/audit` | Admin only: the latest audit-log entries. |
| `POST` | `/auth/logout-all` | Revokes every token issued to the caller (e.g. after losing a phone). |
| `GET` · `POST` | `/auth/users` | Admin only: list accounts, or create a staff account with any role. |
| `PATCH` | `/auth/users/:id` | Admin only: change `role` or set `disabled`. Either revokes that user's tokens. |
| `PUT` | `/observations/:id/photos/:photoId` | Multipart `photo` upload by the sighting's observer (or an admin). Idempotent on the client-generated `photoId`. |
| `GET` | `/observations/:id/photos` · `/photos/:photoId[?size=thumb]` | List or fetch photos (JPEG). Citizens get 403 for sensitive species. |
| `DELETE` | `/photos/:photoId` | Remove a photo (observer or admin). |

## Web portal

- **Temporal migration animator.** The time bar shows a weekly sightings histogram. You can drag it, use the arrow keys (Shift = week), or play it back at 3–60 days/s. Choose either a trailing window (7, 14, 30 or 90 days) or cumulative mode. Sightings fade by age within the window. Weekly centroid paths have direction arrows that grow as time advances.
- **Dynamic habitat hull generator.** Choose concave (α-shape, adjustable tightness) or MCP, and a core %. Run it on the current time window or all time. The results table shows area and the percentage of MCP area, which makes the convex-hull over-estimate visible.
- **Habitat change.** Compares the hulls for two date ranges: gained areas in blue, lost in red, stable in gray.
- **Invasive density.** Choose the GPU KDE heatmap, server hex density, or monthly frontier rings for invasive species.
- **Basemaps.** Topographic (OpenTopoMap, desaturated so the data stands out), streets (OpenFreeMap), or satellite (Esri World Imagery).
- **Colors.** Species get categorical colors in a fixed order, so a species keeps its color when filters change. Invasive species also carry an ink ring, so the distinction never relies on hue alone. Light and dark modes follow the OS.

## Field app

- **Offline maps.** In Settings → *Import .mbtiles*, choose a raster MBTiles file. It is copied into app storage and rendered by `flutter_map_mbtiles`. Without one, the app uses online OSM tiles.
- **Precision tagging.** The log screen streams GPS fixes and keeps the best one until it reaches ±5 m (or 30 s pass). It shows a quality rating and accuracy, and the accuracy is stored with the sighting.
- **Accounts.** Signing in needs a connection once. After that the app works offline for the token's lifetime. The token is stored in the iOS Keychain or Android Keystore. Each queued sighting records which account created it, so a shared device never uploads one person's records under another's name.
- **Photo upload.** Photos queue locally and upload once their sighting is accepted. The queue shows each photo as queued, uploaded or rejected. A file the server permanently refuses, or one deleted from the device, is marked rejected rather than retried.
- **Offline-first sync.** Every sighting goes to SQLite first. The queue uploads in batches of 200 when you save a sighting, when connectivity returns, every 5 minutes, and with exponential backoff (30 s to 15 min) after failures.
- **Identification guide.** 12 bundled species: the six seeded taxa plus key threatened fauna and invasive plants. Each entry has IUCN status, identification features, look-alikes and a field protocol.

### Making an offline basemap

```bash
# From any GeoTIFF / WMS source with GDAL:
gdal_translate -of MBTILES input.tif serengeti.mbtiles
gdaladdo -r average serengeti.mbtiles 2 4 8 16 32   # build lower zoom levels
```

You can also use QGIS → *Processing → Generate XYZ tiles (MBTiles)* over your topographic layers.

## Repository layout

```
db/migrations/        SQL migrations (applied by apps/api/src/migrate.ts)
apps/api/src/         app.ts, routes/{observations,analysis}.ts, ingest.ts, seed.ts
apps/web/components/  Workspace (state + playback), MapView (deck.gl layers), Sidebar, TimeBar
apps/mobile/lib/      models/, data/ (SQLite store, guide), services/ (sync, GPS, tiles), screens/
```

## Next steps

- **Optional OIDC single sign-on** for partner organisations.
- **Vector tiles:** serve tiles straight from PostGIS with [Martin](https://martin.maplibre.org/) once data grows past what one `/observations` response can hold. PMTiles would cover offline vector basemaps.
- **Movement-based home ranges:** Brownian-bridge or autocorrelated KDE, which model the path between fixes rather than treating fixes as independent. Step-selection analysis and live collar feeds (Movebank API) would follow.
