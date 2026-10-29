"use client";

import type { Collars } from "@/lib/useCollars";
import { fmtDate, fmtNum } from "@/lib/format";
import { Section } from "./Sidebar";

export function CollarPanel({ collars, swatch }: { collars: Collars; swatch: (species: string) => string }) {
  const c = collars;
  if (!c.staff) return null;
  return (
    <Section title="Collared animals">
      {c.error && <p className="form-error">{c.error}</p>}
      {!c.individuals.length && <p className="muted small">No collared individuals yet.</p>}
      <ul className="species-list">
        {c.individuals.map((ind) => {
          const track = c.tracks[ind.id];
          const range = c.ranges[ind.id];
          return (
            <li key={ind.id}>
              <label>
                <input type="checkbox" checked={c.selected.has(ind.id)} onChange={() => c.toggleTrack(ind.id)} />
                <span className="swatch" style={{ background: swatch(ind.species_name) }} aria-hidden />
                <span className="species-name">
                  <b>{ind.code}</b> {ind.name && <span>{ind.name}</span>} <i className="muted">{ind.species_name}</i>
                </span>
                <span />
                <span className="count">{fmtNum(ind.fixes)}</span>
              </label>
              {c.selected.has(ind.id) && !track && <div className="collar-stats muted">Loading track…</div>}
              {track && (
                <div className="collar-stats">
                  <span>{fmtNum(track.summary.km_per_day, 1)} km/day</span>
                  <span>{fmtNum(track.summary.total_km)} km total</span>
                  <span>max {fmtNum(track.summary.max_displacement_km)} km from start</span>
                  <span>
                    {track.summary.outliers} GPS outlier{track.summary.outliers === 1 ? "" : "s"} removed
                  </span>
                  <span className="muted">last fix {ind.last_fix ? fmtDate(ind.last_fix) : "–"}</span>
                  <button className="link" onClick={() => c.toggleRange(ind.id)}>
                    {range
                      ? `${range.method === "kde" ? "KDE" : "MCP"} 95% ${fmtNum(range.area_sq_km)} km² · 50% core ${fmtNum(range.core50_area_sq_km)} km² (hide)`
                      : "Show home range (95% + 50% core)"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {Object.keys(c.tracks).length > 0 && (
        <div className="field">
          Home-range method
          <div className="segmented small" role="radiogroup" aria-label="Home-range method">
            <button role="radio" aria-checked={c.rangeMethod === "kde"} className={c.rangeMethod === "kde" ? "on" : ""} onClick={() => c.setRangeMethod("kde")}>
              KDE (density)
            </button>
            <button role="radio" aria-checked={c.rangeMethod === "convex"} className={c.rangeMethod === "convex" ? "on" : ""} onClick={() => c.setRangeMethod("convex")}>
              MCP
            </button>
          </div>
          <small className="muted">
            KDE follows where the animal spends time, so separate activity centres get separate cores. MCP is
            comparable with older studies but can place the core between them.
          </small>
        </div>
      )}
      {Object.keys(c.tracks).length > 0 && (
        <label className="switch-row">
          <span>
            Show GPS outliers
            <small className="muted">Fixes rejected by the speed / out-and-back screen</small>
          </span>
          <input type="checkbox" role="switch" checked={c.showOutliers} onChange={() => c.setShowOutliers(!c.showOutliers)} />
        </label>
      )}
    </Section>
  );
}
