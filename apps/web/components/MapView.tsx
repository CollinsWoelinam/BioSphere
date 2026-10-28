"use client";

import { useEffect, useMemo, useState } from "react";
import DeckGL from "@deck.gl/react";
import { FlyToInterpolator, WebMercatorViewport, type MapViewState, type PickingInfo } from "@deck.gl/core";
import { GeoJsonLayer, IconLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { Map } from "react-map-gl/maplibre";
import { setWorkerUrl, type StyleSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import type { FrontierProps, HullComparison, HullProps, Sighting, Trajectory, TrajectoryStep } from "@/lib/api";
import { DIVERGING, SEQUENTIAL_BLUE, rgba, speciesColor, type Mode } from "@/lib/colors";
import { compass, fmtDate, fmtMonth, fmtNum } from "@/lib/format";
import type { DensityFC, LayerToggles } from "./Workspace";

export type Basemap = "topo" | "streets" | "satellite";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

// Basemaps are muted so the data layers carry the color.
const raster = (tiles: string[], attribution: string, maxzoom = 19, saturation = 0): StyleSpecification => ({
  version: 8,
  sources: { base: { type: "raster", tiles, tileSize: 256, attribution, maxzoom } },
  layers: [{ id: "base", type: "raster", source: "base", paint: { "raster-saturation": saturation, "raster-contrast": -0.1 } }],
});

const BASEMAPS: Record<Basemap, string | StyleSpecification> = {
  topo: raster(
    ["a", "b", "c"].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
    "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
    17,
    -0.75,
  ),
  streets: "https://tiles.openfreemap.org/styles/liberty",
  satellite: raster(
    ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    "Imagery © Esri, Maxar, Earthstar Geographics",
  ),
};

// Upward-pointing arrow, tinted per species via IconLayer mask mode.
const ARROW_ICON = {
  url:
    "data:image/svg+xml;base64," +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><path d="M32 4 L58 56 L32 44 L6 56 Z" fill="#fff"/></svg>'),
  width: 64,
  height: 64,
  mask: true,
};

interface Props {
  mode: Mode;
  basemap: Basemap;
  bounds: [number, number, number, number] | null;
  layers: LayerToggles;
  visible: Sighting[];
  windowStart: number;
  cursor: number;
  colorIndex: globalThis.Map<string, number>;
  hulls: FeatureCollection<Polygon | MultiPolygon, HullProps> | null;
  comparison: HullComparison | null;
  trajectories: Trajectory[];
  frontier: FeatureCollection<Polygon | MultiPolygon, FrontierProps> | null;
  density: DensityFC | null;
  liveIds: Set<string>;
}

interface Segment extends TrajectoryStep {
  species_name: string;
}

export function MapView(p: Props) {
  const [viewState, setViewState] = useState<MapViewState>({ longitude: 34.8, latitude: -2.2, zoom: 7.5 });
  const [fitted, setFitted] = useState(false);

  // Fit to the data the first time species extents arrive.
  useEffect(() => {
    if (!p.bounds || fitted) return;
    const vp = new WebMercatorViewport({ width: window.innerWidth - 360, height: window.innerHeight - 160 });
    const { longitude, latitude, zoom } = vp.fitBounds(
      [
        [p.bounds[0], p.bounds[1]],
        [p.bounds[2], p.bounds[3]],
      ],
      { padding: 40 },
    );
    setViewState({ longitude, latitude, zoom, transitionDuration: 800, transitionInterpolator: new FlyToInterpolator() });
    setFitted(true);
  }, [p.bounds, fitted]);

  const color = (species: string) => speciesColor(p.colorIndex.get(species) ?? 99, p.mode);
  const surface: [number, number, number] = p.mode === "dark" ? [26, 26, 25] : [252, 252, 251];
  const ink: [number, number, number] = p.mode === "dark" ? [240, 239, 236] : [11, 11, 11];

  const segments = useMemo(() => {
    const out: Segment[] = [];
    for (const tr of p.trajectories) {
      if (!p.colorIndex.has(tr.species_name)) continue;
      for (const s of tr.steps) if (Date.parse(s.bucket_start) <= p.cursor) out.push({ ...s, species_name: tr.species_name });
    }
    return out;
  }, [p.trajectories, p.cursor, p.colorIndex]);

  const paths = useMemo(() => {
    const by: Record<string, [number, number][]> = {};
    for (const s of segments) (by[s.species_name] ??= []).push(s.position);
    return Object.entries(by).map(([species_name, path]) => ({ species_name, path }));
  }, [segments]);

  const frontierVisible = useMemo(() => {
    if (!p.frontier) return [];
    // A monthly frontier includes every sighting up to the month's end, so only show it once
    // that month has fully elapsed; otherwise the map would leak future sightings.
    const monthEnd = (iso: string) => {
      const d = new Date(iso);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    };
    const feats = p.frontier.features.filter((f) => monthEnd(f.properties.bucket_start) <= p.cursor);
    const latest: Record<string, number> = {};
    for (const f of feats) latest[f.properties.species_name] = Math.max(latest[f.properties.species_name] ?? 0, Date.parse(f.properties.bucket_start));
    return feats.map((f) => ({ ...f, properties: { ...f.properties, latest: Date.parse(f.properties.bucket_start) === latest[f.properties.species_name] } }));
  }, [p.frontier, p.cursor]);

  const span = Math.max(p.cursor - p.windowStart, 1);

  const deckLayers = [
    p.layers.hex &&
      p.density &&
      new GeoJsonLayer({
        id: "hex-density",
        data: p.density,
        pickable: true,
        stroked: true,
        getLineColor: rgba(surface, 255),
        lineWidthMinPixels: 1,
        getFillColor: (f: Feature<Geometry, { sightings: number }>) => {
          const k = Math.min(SEQUENTIAL_BLUE.length - 1, Math.floor((f.properties.sightings / Math.max(p.density!.max_sightings, 1)) * SEQUENTIAL_BLUE.length));
          return rgba(SEQUENTIAL_BLUE[k], 190);
        },
        updateTriggers: { getFillColor: p.density.max_sightings },
      }),
    p.layers.heatmap &&
      new HeatmapLayer<Sighting>({
        id: "kde-heatmap",
        data: p.visible,
        getPosition: (d) => d.position,
        getWeight: (d) => Math.log1p(d.individual_count),
        radiusPixels: 45,
        intensity: 1.2,
        threshold: 0.04,
        colorRange: SEQUENTIAL_BLUE.slice(1),
      }),
    p.layers.frontier &&
      new GeoJsonLayer({
        id: "invasive-frontier",
        data: frontierVisible,
        pickable: true,
        stroked: true,
        filled: true,
        getFillColor: (f: { properties: FrontierProps & { latest: boolean } }) => rgba(color(f.properties.species_name), f.properties.latest ? 50 : 0),
        getLineColor: (f: { properties: FrontierProps & { latest: boolean } }) => rgba(color(f.properties.species_name), f.properties.latest ? 255 : 110),
        getLineWidth: (f: { properties: { latest: boolean } }) => (f.properties.latest ? 2.5 : 1),
        lineWidthUnits: "pixels",
        updateTriggers: { getFillColor: [p.cursor, p.mode], getLineColor: [p.cursor, p.mode], getLineWidth: p.cursor },
      }),
    p.layers.hull &&
      p.hulls &&
      new GeoJsonLayer({
        id: "home-range",
        data: p.hulls,
        pickable: true,
        getFillColor: (f: Feature<Geometry, HullProps>) => rgba(color(f.properties.species_name), 45),
        getLineColor: (f: Feature<Geometry, HullProps>) => rgba(color(f.properties.species_name), 255),
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        updateTriggers: { getFillColor: p.mode, getLineColor: p.mode },
      }),
    p.comparison &&
      new GeoJsonLayer({
        id: "habitat-change",
        data: [
          { type: "Feature", geometry: p.comparison.lost_geometry, properties: { kind: "lost" } },
          { type: "Feature", geometry: p.comparison.gained_geometry, properties: { kind: "gained" } },
          { type: "Feature", geometry: p.comparison.a_geometry, properties: { kind: "a" } },
          { type: "Feature", geometry: p.comparison.b_geometry, properties: { kind: "b" } },
        ] as Feature[],
        pickable: true,
        getFillColor: (f: Feature) => {
          const k = f.properties!.kind;
          return k === "gained" ? rgba(DIVERGING.gained, 140) : k === "lost" ? rgba(DIVERGING.lost, 140) : rgba(DIVERGING.stable[p.mode], k === "a" ? 70 : 0);
        },
        getLineColor: (f: Feature) => (f.properties!.kind === "b" ? rgba(ink, 255) : f.properties!.kind === "a" ? rgba(ink, 120) : [0, 0, 0, 0]),
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        updateTriggers: { getFillColor: p.mode, getLineColor: p.mode },
      }),
    p.layers.points &&
      new ScatterplotLayer<Sighting>({
        id: "sightings",
        data: p.visible,
        pickable: true,
        radiusUnits: "pixels",
        getRadius: (d) => (p.liveIds.has(d.id) ? 8 : 4),
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: (d) => (d.is_invasive || p.liveIds.has(d.id) ? 1.5 : 1),
        // Invasive species get an ink ring so they read as invasive without relying on hue.
        getLineColor: (d) => (d.is_invasive || p.liveIds.has(d.id) ? rgba(ink, 255) : rgba(surface, 200)),
        // Fade older sightings within the window so recent movement stands out.
        getFillColor: (d) => rgba(color(d.species), 70 + Math.round(185 * ((d.t - p.windowStart) / span))),
        updateTriggers: {
          getFillColor: [p.windowStart, span, p.mode, p.colorIndex],
          getRadius: p.liveIds,
          getLineColor: [p.liveIds, p.mode],
          getLineWidth: p.liveIds,
        },
      }),
    p.layers.trajectory &&
      new PathLayer({
        id: "trajectory-path",
        data: paths,
        getPath: (d: { path: [number, number][] }) => d.path,
        getColor: (d: { species_name: string }) => rgba(color(d.species_name), 230),
        getWidth: 2.5,
        widthUnits: "pixels",
        jointRounded: true,
        capRounded: true,
        updateTriggers: { getColor: p.mode },
      }),
    p.layers.trajectory &&
      new IconLayer<Segment>({
        id: "trajectory-arrows",
        data: segments.filter((s) => s.from_position && (s.distance_km ?? 0) > 2),
        pickable: true,
        getIcon: () => ARROW_ICON,
        // The icon is an inline SVG; decoding it doesn't need a loaders.gl web worker.
        loadOptions: { worker: false },
        getPosition: (s) => [(s.position[0] + s.from_position![0]) / 2, (s.position[1] + s.from_position![1]) / 2],
        // Azimuth is clockwise from north; IconLayer angles are counter-clockwise.
        getAngle: (s) => -(s.bearing_deg ?? 0),
        getSize: 14,
        getColor: (s) => rgba(color(s.species_name), 255),
        updateTriggers: { getColor: p.mode },
      }),
    p.layers.trajectory &&
      new ScatterplotLayer<Segment>({
        id: "trajectory-centroids",
        data: segments,
        pickable: true,
        radiusUnits: "pixels",
        getRadius: 4.5,
        stroked: true,
        lineWidthUnits: "pixels",
        getLineWidth: 2,
        getLineColor: rgba(surface, 255),
        getFillColor: (s) => rgba(color(s.species_name), 255),
        updateTriggers: { getFillColor: p.mode, getLineColor: p.mode },
      }),
  ].filter(Boolean);

  return (
    <DeckGL
      viewState={viewState}
      onViewStateChange={({ viewState: vs }) => setViewState(vs as MapViewState)}
      controller
      layers={deckLayers}
      getTooltip={tooltip}
      getCursor={({ isHovering, isDragging }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab")}
    >
      <Map mapStyle={BASEMAPS[p.basemap]} attributionControl={{ compact: true }} />
    </DeckGL>
  );
}

function tooltip(info: PickingInfo) {
  const o = info.object;
  if (!o) return null;
  const html = (rows: [string, string][], title: string) => ({
    html: `<div class="tt-title">${title}</div>${rows.map(([k, v]) => `<div class="tt-row"><span>${k}</span><b>${v}</b></div>`).join("")}`,
    className: "deck-tooltip-card",
  });

  switch (info.layer?.id) {
    case "sightings": {
      const s = o as Sighting;
      return html(
        [
          ["Observed", new Date(s.t).toLocaleString()],
          ["Count", fmtNum(s.individual_count)],
          ["Observer", s.observer_type.toLowerCase()],
          s.generalized
            ? ["Location", "Generalised to ~11 km (sensitive species)"]
            : ["GPS accuracy", s.accuracy_m != null ? `±${fmtNum(s.accuracy_m, 1)} m` : "–"],
          ...(s.is_invasive ? ([["Status", "Invasive"]] as [string, string][]) : []),
          ...(s.habitat_notes ? ([["Notes", s.habitat_notes]] as [string, string][]) : []),
        ],
        `<i>${s.species}</i>`,
      );
    }
    case "hex-density":
      return html(
        [
          ["Sightings", fmtNum(o.properties.sightings)],
          ["Individuals", fmtNum(o.properties.individuals)],
        ],
        "Density cell",
      );
    case "home-range": {
      const h = o.properties as HullProps;
      return html(
        [
          ["Home range", `${fmtNum(h.area_sq_km)} km²`],
          ["MCP area", `${fmtNum(h.mcp_area_sq_km)} km²`],
          ["Perimeter", `${fmtNum(h.perimeter_km)} km`],
          ["Sightings", fmtNum(h.sightings)],
        ],
        `<i>${h.species_name}</i>`,
      );
    }
    case "invasive-frontier": {
      const f = o.properties as FrontierProps;
      return html(
        [
          ["Infested extent", `${fmtNum(f.area_sq_km, 1)} km²`],
          ["Growth that month", f.growth_sq_km != null ? `+${fmtNum(f.growth_sq_km, 1)} km²` : "–"],
          ["Cumulative records", fmtNum(f.cumulative_sightings)],
        ],
        `<i>${f.species_name}</i> · ${fmtMonth(f.bucket_start)}`,
      );
    }
    case "habitat-change": {
      const kind = o.properties.kind as string;
      const label = { gained: "Habitat gained (B − A)", lost: "Habitat lost (A − B)", a: "Period A range", b: "Period B range" }[kind]!;
      return { html: `<div class="tt-title">${label}</div>`, className: "deck-tooltip-card" };
    }
    case "trajectory-centroids":
    case "trajectory-arrows": {
      const s = o as Segment;
      return html(
        [
          ["Sightings", fmtNum(s.sightings)],
          ["Moved", s.distance_km != null ? `${fmtNum(s.distance_km, 1)} km ${compass(s.bearing_deg ?? 0)}` : "start"],
          ["Speed", s.speed_km_per_day != null ? `${fmtNum(s.speed_km_per_day, 1)} km/day` : "–"],
        ],
        `<i>${s.species_name}</i> · week of ${fmtDate(s.bucket_start)}`,
      );
    }
  }
  return null;
}
