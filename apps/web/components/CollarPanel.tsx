"use client";

import { useRef } from "react";
import type { Collars } from "@/lib/useCollars";
import { fmtDate, fmtNum } from "@/lib/format";
import { Section } from "./Sidebar";

const SEX = { F: "Female", M: "Male", U: "Sex unknown" } as const;

/** Sidebar of the Collared animals view: the individuals and the home-range settings. */
export function CollarSidebar({ collars, swatch }: { collars: Collars; swatch: (species: string) => string }) {
  const c = collars;
  return (
    <aside className="sidebar" aria-label="Collared animals">
      <div className="sidebar-title">
        <h1>Individuals</h1>
        <span className="muted">{c.individuals.length} collared</span>
      </div>
      {c.error && <p className="form-error pad" role="alert">{c.error}</p>}
      {!c.individuals.length && !c.error && <p className="muted pad">No collared individuals yet.</p>}
      <ul className="individual-list">
        {c.individuals.map((ind) => {
          const on = c.selected.has(ind.id);
          return (
            <li key={ind.id}>
              <button
                className={`individual${on ? " on" : ""}${c.focused === ind.id ? " focused" : ""}`}
                aria-pressed={on}
                onClick={() => (on && c.focused !== ind.id ? c.setFocused(ind.id) : c.toggleTrack(ind.id))}
              >
                <span className="code-badge" style={{ "--tint": swatch(ind.species_name) } as React.CSSProperties}>
                  {ind.code}
                </span>
                <span className="individual-text">
                  <b>{ind.name ?? "Unnamed"}</b>
                  <span className="muted">
                    <i>{ind.species_name}</i> · {SEX[ind.sex]}
                    {ind.collar_id && <> · {ind.collar_id}</>}
                  </span>
                </span>
                <span className="individual-meta">
                  <span className="mono">{fmtNum(ind.fixes)} fixes</span>
                  <span className="muted">{ind.last_fix ? fmtDate(ind.last_fix) : "No fixes"}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <Section title="Home range">
        <div className="segmented" role="radiogroup" aria-label="Home-range method">
          <button role="radio" aria-checked={c.rangeMethod === "kde"} className={c.rangeMethod === "kde" ? "on" : ""} onClick={() => c.setRangeMethod("kde")}>
            Kernel density
          </button>
          <button role="radio" aria-checked={c.rangeMethod === "convex"} className={c.rangeMethod === "convex" ? "on" : ""} onClick={() => c.setRangeMethod("convex")}>
            Convex hull (MCP)
          </button>
        </div>
        {c.rangeMethod === "kde" && (
          <label className="field">
            <span className="field-row"><span>Bandwidth × h<sub>ref</sub></span> <b>{c.hScale.toFixed(1)}</b></span>
            <input type="range" min={0.3} max={2} step={0.1} value={c.hScale} onChange={(e) => c.setHScale(Number(e.target.value))} />
            <small className="muted">Lower values follow separate activity centres more closely.</small>
          </label>
        )}
        <label className="switch-row">
          <span>
            Show GPS outliers
            <small className="muted">Fixes rejected by the speed and out-and-back screen</small>
          </span>
          <input type="checkbox" role="switch" checked={c.showOutliers} onChange={() => c.setShowOutliers(!c.showOutliers)} />
        </label>
      </Section>
    </aside>
  );
}

/** Heading and figures for the focused individual, shown above the map. */
export function CollarSummary({ collars }: { collars: Collars }) {
  const c = collars;
  const fileRef = useRef<HTMLInputElement>(null);
  const ind = c.individuals.find((i) => i.id === c.focused);
  const track = ind && c.tracks[ind.id];
  const range = ind && c.ranges[ind.id];

  if (!ind) {
    return (
      <div className="collar-summary empty">
        <h1>Collared animals</h1>
        <p className="muted">Select an individual to show its track and home range.</p>
      </div>
    );
  }

  return (
    <div className="collar-summary">
      <div className="collar-heading">
        <div>
          <div className="eyebrow">{ind.code} · <i>{ind.species_name}</i></div>
          <h1>{ind.name ?? "Unnamed"}</h1>
        </div>
        <div className="collar-actions">
          {c.canImport && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) c.importFixes(ind.id, f);
                  e.target.value = "";
                }}
              />
              <button className="secondary" onClick={() => fileRef.current?.click()}>Import Movebank CSV</button>
            </>
          )}
          <button className="primary" onClick={() => c.toggleRange(ind.id)} disabled={!track}>
            {range ? "Hide home range" : "Show home range"}
          </button>
        </div>
      </div>
      {c.notice && <p className="notice" role="status">{c.notice}</p>}
      <div className="stat-cards">
        <Stat label="95% range" value={range ? fmtNum(range.area_sq_km) : "–"} unit={range ? "km²" : undefined} />
        <Stat label="50% core area" value={range ? fmtNum(range.core50_area_sq_km) : "–"} unit={range ? "km²" : undefined} />
        <Stat label="GPS fixes" value={track ? fmtNum(track.summary.fixes) : fmtNum(ind.fixes)} />
        <Stat label="Outliers removed" value={track ? fmtNum(track.summary.outliers) : "–"} tone={track?.summary.outliers ? "warn" : undefined} />
        <Stat label="Daily distance" value={track?.summary.km_per_day != null ? fmtNum(track.summary.km_per_day, 1) : "–"} unit={track?.summary.km_per_day != null ? "km" : undefined} />
      </div>
    </div>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: "warn" }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong className={tone}>
        {value}
        {unit && <small> {unit}</small>}
      </strong>
    </div>
  );
}
