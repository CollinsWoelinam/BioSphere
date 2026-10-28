"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  api,
  toSighting,
  type FrontierProps,
  type HullComparison,
  type HullProps,
  type Observation,
  type Sighting,
  type Species,
  type Trajectory,
} from "@/lib/api";
import { useColorMode } from "@/lib/useColorMode";
import { MapView, type Basemap } from "./MapView";
import { Sidebar } from "./Sidebar";
import { TimeBar } from "./TimeBar";

import { DAY } from "@/lib/format";

export interface LayerToggles {
  points: boolean;
  heatmap: boolean;
  hex: boolean;
  trajectory: boolean;
  hull: boolean;
  frontier: boolean;
}

export interface HullOptions {
  method: "concave" | "convex";
  pct: number;
  core: number;
  scope: "window" | "all";
}

export interface CompareRequest {
  species: string;
  a_from: string;
  a_to: string;
  b_from: string;
  b_to: string;
}

export type DensityFC = FeatureCollection<Polygon, { sightings: number; individuals: number }> & {
  max_sightings: number;
};

export function Workspace() {
  const mode = useColorMode();
  const [species, setSpecies] = useState<Species[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- time state -----------------------------------------------------------
  const [cursor, setCursor] = useState(0);
  const [windowDays, setWindowDays] = useState(30); // 0 = cumulative
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10); // simulated days per second

  const [layers, setLayers] = useState<LayerToggles>({
    points: true,
    heatmap: false,
    hex: false,
    trajectory: true,
    hull: true,
    frontier: false,
  });
  const [basemap, setBasemap] = useState<Basemap>("topo");

  // --- analysis results -----------------------------------------------------
  const [hullOptions, setHullOptions] = useState<HullOptions>({ method: "concave", pct: 0.7, core: 100, scope: "window" });
  const [hulls, setHulls] = useState<FeatureCollection<Polygon | MultiPolygon, HullProps> | null>(null);
  const [hullBusy, setHullBusy] = useState(false);
  const [comparison, setComparison] = useState<HullComparison | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const [trajectories, setTrajectories] = useState<Trajectory[]>([]);
  const [frontier, setFrontier] = useState<FeatureCollection<Polygon | MultiPolygon, FrontierProps> | null>(null);
  const [density, setDensity] = useState<DensityFC | null>(null);
  const [cellKm, setCellKm] = useState(4);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveIds, setLiveIds] = useState<Set<string>>(new Set());

  /** Fixed categorical slot per species (alphabetical), so colors never repaint on filter. */
  const colorIndex = useMemo(() => new Map(species.map((s, i) => [s.species_name, i])), [species]);

  useEffect(() => {
    api
      .species()
      .then((list) => {
        setSpecies(list);
        setSelected(list.map((s) => s.species_name));
      })
      .catch((e) => setError(`Cannot reach the BioSphere API: ${e.message}`));
  }, []);

  useEffect(() => {
    if (!selected.length) {
      setSightings([]);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    api
      .observations({ species: selected }, ctrl.signal)
      .then((fc) => setSightings((fc.features as Observation[]).map(toSighting)))
      .catch((e) => e.name !== "AbortError" && setError(e.message))
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [selected]);

  const domain = useMemo<[number, number]>(() => {
    if (!sightings.length) return [Date.now() - 365 * DAY, Date.now()];
    // sightings arrive ordered by observed_at
    return [sightings[0].t, sightings[sightings.length - 1].t];
  }, [sightings]);

  // Keep the cursor inside the data domain; start at the end so the full picture shows first.
  useEffect(() => {
    setCursor((c) => (c < domain[0] || c > domain[1] ? domain[1] : c));
  }, [domain]);

  const windowStart = windowDays === 0 ? domain[0] : cursor - windowDays * DAY;
  const visible = useMemo(
    () => sightings.filter((s) => s.t >= windowStart && s.t <= cursor),
    [sightings, windowStart, cursor],
  );

  // --- playback loop ----------------------------------------------------------
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      let stop = false;
      setCursor((c) => {
        const next = c + dt * speed * DAY;
        if (next >= domain[1]) {
          stop = true;
          return domain[1];
        }
        return next;
      });
      if (stop) setPlaying(false);
      else rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, domain]);

  const togglePlay = useCallback(() => {
    setPlaying((p) => {
      if (!p && cursor >= domain[1] - DAY) setCursor(domain[0] + (windowDays || 7) * DAY);
      return !p;
    });
  }, [cursor, domain, windowDays]);

  // --- live websocket feed ----------------------------------------------------
  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(api.liveUrl());
      ws.onopen = () => setLiveConnected(true);
      ws.onclose = () => {
        setLiveConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type !== "observations.created") return;
        const incoming = (msg.features as Observation[]).map(toSighting);
        setSightings((prev) => {
          const known = new Set(prev.map((s) => s.id));
          const fresh = incoming.filter((s) => !known.has(s.id) && selectedRef.current.includes(s.species));
          return fresh.length ? [...prev, ...fresh].sort((a, b) => a.t - b.t) : prev;
        });
        setLiveIds((prev) => new Set([...prev, ...incoming.map((s) => s.id)]));
        if (incoming.some((s) => !colorIndex.has(s.species))) api.species().then(setSpecies);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      ws?.close();
    };
  }, [colorIndex]);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // --- server analyses --------------------------------------------------------
  const iso = (t: number) => new Date(t).toISOString();

  const computeHulls = useCallback(async () => {
    setHullBusy(true);
    try {
      const range = hullOptions.scope === "window" ? { from: iso(windowStart), to: iso(cursor + 1) } : {};
      setHulls(await api.homeRange({ species: selected, ...range }, hullOptions));
      setLayers((l) => ({ ...l, hull: true }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHullBusy(false);
    }
  }, [hullOptions, selected, windowStart, cursor]);

  const runCompare = useCallback(
    async (req: CompareRequest) => {
      setCompareBusy(true);
      setComparison(null);
      try {
        setComparison(await api.compare({ ...req, ...hullOptions }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setCompareBusy(false);
      }
    },
    [hullOptions],
  );

  const invasiveSelected = useMemo(
    () => selected.filter((n) => species.find((s) => s.species_name === n)?.is_invasive),
    [selected, species],
  );
  // Plants don't migrate: invasive spread is shown by the frontier layer instead.
  const mobileSelected = useMemo(() => selected.filter((n) => !invasiveSelected.includes(n)), [selected, invasiveSelected]);

  useEffect(() => {
    if (!layers.trajectory || !mobileSelected.length) {
      setTrajectories([]);
      return;
    }
    api.trajectory({ species: mobileSelected }, "week").then((r) => setTrajectories(r.species)).catch(() => {});
  }, [layers.trajectory, mobileSelected]);
  useEffect(() => {
    if (!layers.frontier || !invasiveSelected.length) {
      setFrontier(null);
      return;
    }
    api.frontier({ species: invasiveSelected }).then(setFrontier).catch(() => {});
  }, [layers.frontier, invasiveSelected]);

  // Hex density: throttled to one request in flight, always converging on the latest window.
  const densityKey = layers.hex && selected.length ? `${selected.join("|")}:${Math.floor(windowStart / DAY)}:${Math.floor(cursor / DAY)}:${cellKm}` : "";
  const densityInFlight = useRef(false);
  const densityPending = useRef<string | null>(null);
  const densityParams = useRef({ selected, windowStart, cursor, cellKm });
  densityParams.current = { selected, windowStart, cursor, cellKm };
  const fetchDensity = useCallback(() => {
    if (densityInFlight.current) {
      densityPending.current = "pending";
      return;
    }
    densityInFlight.current = true;
    const p = densityParams.current;
    api
      .density({ species: p.selected, from: iso(p.windowStart), to: iso(p.cursor + 1) }, p.cellKm)
      .then(setDensity)
      .catch(() => {})
      .finally(() => {
        densityInFlight.current = false;
        if (densityPending.current) {
          densityPending.current = null;
          fetchDensity();
        }
      });
  }, []);
  useEffect(() => {
    if (densityKey) fetchDensity();
    else setDensity(null);
  }, [densityKey, fetchDensity]);

  const bounds = useMemo(() => {
    const boxes = species.filter((s) => selected.includes(s.species_name)).map((s) => s.bbox);
    if (!boxes.length) return null;
    return [
      Math.min(...boxes.map((b) => b[0])),
      Math.min(...boxes.map((b) => b[1])),
      Math.max(...boxes.map((b) => b[2])),
      Math.max(...boxes.map((b) => b[3])),
    ] as [number, number, number, number];
  }, [species, selected]);

  return (
    <div className="workspace">
      <Sidebar
        mode={mode}
        species={species}
        selected={selected}
        onSelectedChange={setSelected}
        colorIndex={colorIndex}
        layers={layers}
        onLayersChange={setLayers}
        basemap={basemap}
        onBasemapChange={setBasemap}
        hullOptions={hullOptions}
        onHullOptionsChange={setHullOptions}
        onComputeHulls={computeHulls}
        hulls={hulls}
        hullBusy={hullBusy}
        onCompare={runCompare}
        comparison={comparison}
        compareBusy={compareBusy}
        onClearComparison={() => setComparison(null)}
        trajectories={trajectories}
        frontier={frontier}
        invasiveSelected={invasiveSelected}
        cellKm={cellKm}
        onCellKmChange={setCellKm}
        domain={domain}
        liveConnected={liveConnected}
      />
      <main className="map-pane">
        <MapView
          mode={mode}
          basemap={basemap}
          bounds={bounds}
          layers={layers}
          visible={visible}
          windowStart={windowStart}
          cursor={cursor}
          colorIndex={colorIndex}
          hulls={hulls}
          comparison={comparison}
          trajectories={trajectories}
          frontier={frontier}
          density={density}
          liveIds={liveIds}
        />
        {error && (
          <div className="toast" role="alert">
            <span>{error}</span>
            <button className="ghost" onClick={() => setError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        {loading && <div className="loading-pill">Loading sightings…</div>}
        <TimeBar
          sightings={sightings}
          domain={domain}
          cursor={cursor}
          windowStart={windowStart}
          onCursorChange={(c) => {
            setPlaying(false);
            setCursor(c);
          }}
          playing={playing}
          onTogglePlay={togglePlay}
          speed={speed}
          onSpeedChange={setSpeed}
          windowDays={windowDays}
          onWindowDaysChange={setWindowDays}
          visibleCount={visible.length}
        />
      </main>
    </div>
  );
}
