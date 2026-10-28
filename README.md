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
pnpm db:seed        # ~4,000 synthetic Serengeti–Mara sightings over 12 months
pnpm dev:api        # http://localhost:4000
pnpm dev:web        # http://localhost:3000
```

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

## Data model

[`db/migrations/001_init.sql`](db/migrations/001_init.sql) contains the spec's `species_observations` table plus a few field-data columns:

- `accuracy_m` and `altitude_m`: GPS quality, so analyses can filter out coarse fixes.
- `individual_count`: herd size. It weights the heatmap and density layers.
- `habitat_notes` and `device_id`.
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
| `GET` | `/health` | Liveness check, including the PostGIS and GEOS versions. |

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

- **Auth:** JWT or OIDC, with roles for ranger and citizen. Hide sensitive-species locations (rhino) from citizen accounts. This is required before deploying anywhere public.
- **Photo upload:** send photos to object storage and link them to observations. Photos are currently kept on the device only.
- **Vector tiles:** serve tiles straight from PostGIS with [Martin](https://martin.maplibre.org/) once data grows past what one `/observations` response can hold. PMTiles would cover offline vector basemaps.
- **Movement ecology on collared individuals:** add `individual_id` to the schema to support per-animal tracks, Brownian-bridge home ranges and step-selection analysis.
