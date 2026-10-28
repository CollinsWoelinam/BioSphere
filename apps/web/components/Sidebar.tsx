"use client";

import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { seesExactLocations, type FrontierProps, type HullComparison, type HullProps, type SessionUser, type Species, type Trajectory } from "@/lib/api";
import { speciesColorHex, type Mode } from "@/lib/colors";
import { fmtDate, fmtNum } from "@/lib/format";
import type { Basemap } from "./MapView";
import type { CompareRequest, HullOptions, LayerToggles } from "./Workspace";

interface Props {
  user: SessionUser;
  onSignOut: () => void;
  /** Selected species this viewer may analyse (excludes sensitive ones for citizens). */
  analysable: string[];
  mode: Mode;
  species: Species[];
  selected: string[];
  onSelectedChange: (s: string[]) => void;
  colorIndex: Map<string, number>;
  layers: LayerToggles;
  onLayersChange: (l: LayerToggles) => void;
  basemap: Basemap;
  onBasemapChange: (b: Basemap) => void;
  hullOptions: HullOptions;
  onHullOptionsChange: (o: HullOptions) => void;
  onComputeHulls: () => void;
  hulls: FeatureCollection<Polygon | MultiPolygon, HullProps> | null;
  hullBusy: boolean;
  onCompare: (r: CompareRequest) => void;
  comparison: HullComparison | null;
  compareBusy: boolean;
  onClearComparison: () => void;
  trajectories: Trajectory[];
  frontier: FeatureCollection<Polygon | MultiPolygon, FrontierProps> | null;
  invasiveSelected: string[];
  cellKm: number;
  onCellKmChange: (n: number) => void;
  domain: [number, number];
  liveConnected: boolean;
}

const LAYER_LABELS: [keyof LayerToggles, string, string][] = [
  ["points", "Sightings", "Observation points, faded by age"],
  ["heatmap", "KDE heatmap", "Gaussian kernel density (GPU)"],
  ["hex", "Hex density", "Server-side hexagonal binning"],
  ["trajectory", "Migration vectors", "Weekly centroid displacement"],
  ["hull", "Home ranges", "Computed hull polygons"],
  ["frontier", "Invasive frontier", "Monthly spread of invasive species"],
];

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export function Sidebar(p: Props) {
  const swatch = (name: string) => speciesColorHex(p.colorIndex.get(name) ?? 99, p.mode);
  const toggle = (name: string) =>
    p.onSelectedChange(p.selected.includes(name) ? p.selected.filter((s) => s !== name) : [...p.selected, name]);

  return (
    <aside className="sidebar">
      <header className="brand">
        <div>
          <h1>BioSphere</h1>
          <p className="muted">Research &amp; Analytics Portal</p>
        </div>
        <span className={`live ${p.liveConnected ? "on" : "off"}`} title={p.liveConnected ? "Receiving field sightings live" : "Live feed disconnected"}>
          <span className="dot" aria-hidden />
          {p.liveConnected ? "Live" : "Offline"}
        </span>
      </header>

      <div className="account">
        <span>
          {p.user.name}
          <span className="role">{p.user.role}</span>
        </span>
        <button className="link" onClick={p.onSignOut}>Sign out</button>
      </div>

      <Section title="Species" aside={
        <span className="link-row">
          <button className="link" onClick={() => p.onSelectedChange(p.species.map((s) => s.species_name))}>All</button>
          <button className="link" onClick={() => p.onSelectedChange([])}>None</button>
        </span>
      }>
        <ul className="species-list">
          {p.species.map((s) => (
            <li key={s.species_name}>
              <label>
                <input type="checkbox" checked={p.selected.includes(s.species_name)} onChange={() => toggle(s.species_name)} />
                <span className={`swatch${s.is_invasive ? " ring" : ""}`} style={{ background: swatch(s.species_name) }} aria-hidden />
                <span className="species-name"><i>{s.species_name}</i></span>
                {s.is_invasive && <span className="tag">Invasive</span>}
                {s.is_sensitive && (
                  <span className="tag sensitive" title="Locations protected from public view">Sensitive</span>
                )}
                <span className="count">{fmtNum(s.sightings)}</span>
              </label>
            </li>
          ))}
          {!p.species.length && <li className="muted">No species loaded yet.</li>}
        </ul>
        {!seesExactLocations(p.user) && p.species.some((s) => s.is_sensitive) && (
          <p className="notice">
            Sensitive species are shown at ~11 km resolution and are left out of hulls, vectors and density.
          </p>
        )}
      </Section>

      <Section title="Map layers">
        <div className="segmented" role="radiogroup" aria-label="Basemap">
          {(["topo", "streets", "satellite"] as Basemap[]).map((b) => (
            <button key={b} role="radio" aria-checked={p.basemap === b} className={p.basemap === b ? "on" : ""} onClick={() => p.onBasemapChange(b)}>
              {b === "topo" ? "Topographic" : b === "streets" ? "Streets" : "Satellite"}
            </button>
          ))}
        </div>
        <ul className="layer-list">
          {LAYER_LABELS.map(([key, label, hint]) => (
            <li key={key}>
              <label className="switch-row">
                <span>
                  {label}
                  <small className="muted">{hint}</small>
                </span>
                <input type="checkbox" role="switch" checked={p.layers[key]} onChange={() => p.onLayersChange({ ...p.layers, [key]: !p.layers[key] })} />
              </label>
            </li>
          ))}
        </ul>
        {p.layers.hex && (
          <label className="field">
            Hex cell size <b>{p.cellKm} km</b>
            <input type="range" min={1} max={15} step={1} value={p.cellKm} onChange={(e) => p.onCellKmChange(Number(e.target.value))} />
          </label>
        )}
        {(p.layers.heatmap || p.layers.hex) && <SequentialLegend />}
      </Section>

      <Section title="Home range hull">
        <div className="segmented" role="radiogroup" aria-label="Hull method">
          {(["concave", "convex"] as const).map((m) => (
            <button key={m} role="radio" aria-checked={p.hullOptions.method === m} className={p.hullOptions.method === m ? "on" : ""} onClick={() => p.onHullOptionsChange({ ...p.hullOptions, method: m })}>
              {m === "concave" ? "Concave (α-shape)" : "Convex (MCP)"}
            </button>
          ))}
        </div>
        {p.hullOptions.method === "concave" && (
          <label className="field">
            Tightness <b>{p.hullOptions.pct.toFixed(2)}</b>
            <input type="range" min={0.1} max={1} step={0.05} value={p.hullOptions.pct} onChange={(e) => p.onHullOptionsChange({ ...p.hullOptions, pct: Number(e.target.value) })} />
            <small className="muted">ST_ConcaveHull target: 1 = convex, lower hugs clusters</small>
          </label>
        )}
        <label className="field">
          Core range <b>{p.hullOptions.core}%</b>
          <input type="range" min={50} max={100} step={5} value={p.hullOptions.core} onChange={(e) => p.onHullOptionsChange({ ...p.hullOptions, core: Number(e.target.value) })} />
          <small className="muted">Drops the farthest outliers from the centroid (95% = MCP95)</small>
        </label>
        <div className="segmented small" role="radiogroup" aria-label="Hull time scope">
          <button role="radio" aria-checked={p.hullOptions.scope === "window"} className={p.hullOptions.scope === "window" ? "on" : ""} onClick={() => p.onHullOptionsChange({ ...p.hullOptions, scope: "window" })}>Current window</button>
          <button role="radio" aria-checked={p.hullOptions.scope === "all"} className={p.hullOptions.scope === "all" ? "on" : ""} onClick={() => p.onHullOptionsChange({ ...p.hullOptions, scope: "all" })}>All time</button>
        </div>
        <button className="primary" onClick={p.onComputeHulls} disabled={p.hullBusy || !p.analysable.length}>
          {p.hullBusy ? "Computing…" : "Compute home ranges"}
        </button>
        {p.hulls && (
          <table className="data-table">
            <thead>
              <tr><th>Species</th><th className="num">km²</th><th className="num">vs MCP</th></tr>
            </thead>
            <tbody>
              {p.hulls.features.map((f) => (
                <tr key={f.properties.species_name}>
                  <td><span className="swatch sm" style={{ background: swatch(f.properties.species_name) }} aria-hidden /><i>{f.properties.species_name}</i></td>
                  <td className="num">{fmtNum(f.properties.area_sq_km)}</td>
                  <td className="num">{fmtNum((f.properties.area_sq_km / Math.max(f.properties.mcp_area_sq_km, 1e-9)) * 100)}%</td>
                </tr>
              ))}
              {!p.hulls.features.length && <tr><td colSpan={3} className="muted">Not enough sightings (≥ 3 per species) in this range.</td></tr>}
            </tbody>
          </table>
        )}
      </Section>

      <CompareSection {...p} />

      {p.layers.trajectory && p.trajectories.length > 0 && (
        <Section title="Migration distance">
          <table className="data-table">
            <thead><tr><th>Species</th><th className="num">Total km</th><th className="num">Max wk km</th></tr></thead>
            <tbody>
              {p.trajectories.filter((t) => p.selected.includes(t.species_name)).map((t) => (
                <tr key={t.species_name}>
                  <td><span className="swatch sm" style={{ background: swatch(t.species_name) }} aria-hidden /><i>{t.species_name}</i></td>
                  <td className="num">{fmtNum(t.total_distance_km)}</td>
                  <td className="num">{fmtNum(Math.max(0, ...t.steps.map((s) => Number(s.distance_km) || 0)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <small className="muted">Distance between consecutive weekly centroids of all sightings.</small>
        </Section>
      )}

      {p.layers.frontier && (
        <Section title="Invasive frontier">
          {!p.invasiveSelected.length && <p className="muted">Select an invasive species to track its spread.</p>}
          {p.frontier && <FrontierSummary frontier={p.frontier} swatch={swatch} />}
        </Section>
      )}
    </aside>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function SequentialLegend() {
  return (
    <div className="seq-legend">
      <span className="muted">Low</span>
      <span className="ramp" aria-hidden />
      <span className="muted">High density</span>
    </div>
  );
}

function CompareSection(p: Props) {
  const [species, setSpecies] = useState("");
  const [d0, d1] = p.domain;
  const mid = d0 + (d1 - d0) / 2;
  const [range, setRange] = useState({ a_from: "", a_to: "", b_from: "", b_to: "" });

  useEffect(() => {
    setRange({ a_from: isoDay(d0), a_to: isoDay(d0 + (d1 - d0) / 3), b_from: isoDay(mid + (d1 - d0) / 6), b_to: isoDay(d1 + 86_400_000) });
  }, [d0, d1, mid]);
  useEffect(() => {
    if (!p.analysable.includes(species)) setSpecies(p.analysable[0] ?? "");
  }, [p.analysable, species]);

  const c = p.comparison;
  const changeClass = useMemo(() => (c?.change_percent == null ? "" : c.change_percent >= 0 ? "up" : "down"), [c]);
  const set = (k: keyof typeof range) => (e: React.ChangeEvent<HTMLInputElement>) => setRange({ ...range, [k]: e.target.value });

  return (
    <Section title="Habitat change" aside={c && <button className="link" onClick={p.onClearComparison}>Clear</button>}>
      <label className="field">
        Species
        <select value={species} onChange={(e) => setSpecies(e.target.value)}>
          {p.analysable.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <div className="period-grid">
        <span className="period-label">A</span>
        <input type="date" aria-label="Period A start" value={range.a_from} onChange={set("a_from")} />
        <input type="date" aria-label="Period A end" value={range.a_to} onChange={set("a_to")} />
        <span className="period-label">B</span>
        <input type="date" aria-label="Period B start" value={range.b_from} onChange={set("b_from")} />
        <input type="date" aria-label="Period B end" value={range.b_to} onChange={set("b_to")} />
      </div>
      <button
        className="primary"
        disabled={!species || p.compareBusy}
        onClick={() =>
          p.onCompare({
            species,
            a_from: `${range.a_from}T00:00:00Z`,
            a_to: `${range.a_to}T00:00:00Z`,
            b_from: `${range.b_from}T00:00:00Z`,
            b_to: `${range.b_to}T00:00:00Z`,
          })
        }
      >
        {p.compareBusy ? "Comparing…" : "Compare periods"}
      </button>
      {c && (
        <>
          <div className="stat-row">
            <div className="stat">
              <span className="muted">Area change</span>
              <strong className={changeClass}>
                {c.change_percent == null ? "–" : `${c.change_percent >= 0 ? "▲" : "▼"} ${fmtNum(Math.abs(c.change_percent), 1)}%`}
              </strong>
            </div>
            <div className="stat">
              <span className="muted">A → B</span>
              <strong>{fmtNum(c.a_area_sq_km)} → {fmtNum(c.b_area_sq_km)} km²</strong>
            </div>
          </div>
          <ul className="legend">
            <li><span className="swatch gained" aria-hidden />Gained <b>{fmtNum(c.gained_sq_km, 1)} km²</b></li>
            <li><span className="swatch lost" aria-hidden />Lost <b>{fmtNum(c.lost_sq_km, 1)} km²</b></li>
            <li><span className="swatch stable" aria-hidden />Stable <b>{fmtNum(c.stable_sq_km, 1)} km²</b></li>
          </ul>
        </>
      )}
    </Section>
  );
}

function FrontierSummary({ frontier, swatch }: { frontier: FeatureCollection<Polygon | MultiPolygon, FrontierProps>; swatch: (n: string) => string }) {
  const latest = new Map<string, FrontierProps>();
  for (const f of frontier.features) latest.set(f.properties.species_name, f.properties);
  return (
    <table className="data-table">
      <thead><tr><th>Species</th><th className="num">Extent km²</th><th className="num">Last month</th></tr></thead>
      <tbody>
        {[...latest.values()].map((f) => (
          <tr key={f.species_name}>
            <td><span className="swatch sm ring" style={{ background: swatch(f.species_name) }} aria-hidden /><i>{f.species_name}</i></td>
            <td className="num">{fmtNum(f.area_sq_km, 1)}</td>
            <td className="num">{f.growth_sq_km != null ? `+${fmtNum(f.growth_sq_km, 1)}` : "–"}</td>
          </tr>
        ))}
      </tbody>
      <caption className="muted">As of {fmtDate(Math.max(...[...latest.values()].map((f) => Date.parse(f.bucket_start))))}; rings show each month's frontier.</caption>
    </table>
  );
}
