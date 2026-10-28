// MapLibre 6 spawns its tile worker from a separate ES module that Next.js does not bundle,
// so we serve a copy from /public and point maplibregl.setWorkerUrl at it.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve("maplibre-gl/dist/maplibre-gl-worker.mjs"));
const out = path.resolve(import.meta.dirname, "../public/maplibre");
mkdirSync(out, { recursive: true });
copyFileSync(path.join(dist, "maplibre-gl-worker.mjs"), path.join(out, "maplibre-gl-worker.mjs"));
console.log("copied maplibre worker to public/maplibre");
