import { contours } from "d3-contour";
import type { MultiPolygon } from "geojson";

/**
 * Fixed-kernel density estimate of an animal's utilisation distribution (UD) and its
 * percent-volume isopleths, the standard "KDE home range" (Worton 1989).
 *
 * Fixes are projected to a local equirectangular plane in metres around their mean;
 * across the ~100 km extents of a home range the distortion is well under 1%.
 * Bandwidth defaults to the reference bandwidth h_ref = sqrt((σx² + σy²) / 2) · n^(-1/6),
 * scaled by `hScale`. h_ref is known to oversmooth multimodal ranges, so callers can
 * pass hScale < 1 (0.5–0.8 is common in the literature).
 *
 * Caveat: the estimator assumes independent fixes. Regular collar fixes are
 * autocorrelated, which mainly makes h_ref smaller than it should be for the
 * sample size, and doesn't bias the shape of the isopleths.
 */

export interface KdeOptions {
  /** Multiplier on the reference bandwidth. */
  hScale?: number;
  /** Isopleth volumes to return, e.g. [95, 50]. */
  levels?: number[];
  /** Grid cells per bandwidth; 4 resolves contours smoothly without blowing up the grid. */
  cellsPerBandwidth?: number;
  /** Hard cap on grid cells per side. */
  maxCells?: number;
}

export interface KdeResult {
  bandwidth_m: number;
  cell_m: number;
  isopleths: { level: number; area_sq_km: number; geometry: MultiPolygon }[];
}

const M_PER_DEG_LAT = 110_574;
const M_PER_DEG_LON_EQ = 111_320;

export function kdeHomeRange(points: { lon: number; lat: number }[], opts: KdeOptions = {}): KdeResult | null {
  const { hScale = 1, levels = [95, 50], cellsPerBandwidth = 4, maxCells = 400 } = opts;
  const n = points.length;
  if (n < 5) return null;

  // Local metric projection around the mean position.
  const lon0 = points.reduce((s, p) => s + p.lon, 0) / n;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / n;
  const kx = M_PER_DEG_LON_EQ * Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => (p.lon - lon0) * kx);
  const ys = points.map((p) => (p.lat - lat0) * M_PER_DEG_LAT);

  const variance = (v: number[]) => v.reduce((s, x) => s + x * x, 0) / (v.length - 1); // mean is 0
  const sigma = Math.sqrt((variance(xs) + variance(ys)) / 2);
  if (!(sigma > 0)) return null;
  const h = sigma * Math.pow(n, -1 / 6) * hScale;

  // Grid covering the fixes plus 3h on each side (where the kernel is ~0).
  const pad = 3 * h;
  const minX = Math.min(...xs) - pad;
  const minY = Math.min(...ys) - pad;
  const spanX = Math.max(...xs) + pad - minX;
  const spanY = Math.max(...ys) + pad - minY;
  const cell = Math.max(h / cellsPerBandwidth, spanX / maxCells, spanY / maxCells);
  const nx = Math.ceil(spanX / cell);
  const ny = Math.ceil(spanY / cell);

  // Accumulate Gaussian kernels; each point only touches cells within 3h.
  const density = new Float64Array(nx * ny);
  const reach = Math.ceil((3 * h) / cell);
  const inv2h2 = 1 / (2 * h * h);
  for (let k = 0; k < n; k++) {
    const gx = (xs[k] - minX) / cell - 0.5;
    const gy = (ys[k] - minY) / cell - 0.5;
    const ci = Math.round(gx);
    const cj = Math.round(gy);
    for (let j = Math.max(0, cj - reach); j <= Math.min(ny - 1, cj + reach); j++) {
      const dy = (j - gy) * cell;
      for (let i = Math.max(0, ci - reach); i <= Math.min(nx - 1, ci + reach); i++) {
        const dx = (i - gx) * cell;
        density[j * nx + i] += Math.exp(-(dx * dx + dy * dy) * inv2h2);
      }
    }
  }

  // Percent-volume thresholds: the density above which the highest cells hold `level`% of the mass.
  const sorted = Array.from(density).sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  const cellKm2 = (cell * cell) / 1e6;
  const thresholds = levels.map((level) => {
    const target = (level / 100) * total;
    let acc = 0;
    let idx = 0;
    while (idx < sorted.length && acc < target) acc += sorted[idx++];
    return { level, threshold: sorted[Math.max(0, idx - 1)], cells: idx };
  });

  // Contours in grid space (cell i spans [i, i+1]) → metres → lon/lat.
  const toLonLat = ([gx, gy]: number[]): [number, number] => [
    round6(lon0 + (minX + gx * cell) / kx),
    round6(lat0 + (minY + gy * cell) / M_PER_DEG_LAT),
  ];
  const generator = contours().size([nx, ny]).smooth(true);
  const isopleths = thresholds.map(({ level, threshold, cells }) => {
    const [c] = generator.thresholds([threshold])(Array.from(density));
    return {
      level,
      area_sq_km: cells * cellKm2,
      geometry: {
        type: "MultiPolygon" as const,
        coordinates: c.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat))),
      },
    };
  });

  return { bandwidth_m: h, cell_m: cell, isopleths };
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;
