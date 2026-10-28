import { z } from "zod";

const lon = z.number().min(-180).max(180);
const lat = z.number().min(-90).max(90);

export const observationFeature = z.object({
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.literal("Point"),
    coordinates: z.union([z.tuple([lon, lat]), z.tuple([lon, lat, z.number()])]),
  }),
  properties: z.object({
    id: z.uuid().optional(),
    species: z.string().trim().min(1).max(100),
    is_invasive: z.boolean().default(false),
    observer_type: z.enum(["RANGER", "CITIZEN"]).default("RANGER"),
    timestamp: z.iso.datetime({ offset: true }),
    accuracy_m: z.number().nonnegative().nullish(),
    altitude_m: z.number().nullish(),
    individual_count: z.number().int().positive().default(1),
    habitat_notes: z.string().max(2000).nullish(),
    device_id: z.string().max(64).nullish(),
  }),
});

export const observationIngest = z.union([
  observationFeature,
  z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(observationFeature).min(1).max(2000),
  }),
]);

export type ObservationFeature = z.infer<typeof observationFeature>;

const bbox = z
  .string()
  .transform((s) => s.split(",").map(Number))
  .pipe(
    z
      .tuple([lon, lat, lon, lat])
      .refine(([w, s, e, n]) => w < e && s < n, "bbox must be minLon,minLat,maxLon,maxLat"),
  );

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const observationFilter = z.object({
  species: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined)),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  bbox: bbox.optional(),
  invasive: bool.optional(),
  observer_type: z.enum(["RANGER", "CITIZEN"]).optional(),
});

export type ObservationFilter = z.infer<typeof observationFilter>;

export const bucket = z.enum(["day", "week", "month"]).default("week");

/** PostGIS param_pctconvex: 1 = convex hull, lower = tighter. */
export const pctConvex = z.coerce.number().min(0).max(1).default(0.7);

/** Classic "MCP 95%" outlier trimming: keep the N% of points nearest the centroid. */
export const corePercent = z.coerce.number().min(10).max(100).default(100);
