"use client";

import { useRef, useState } from "react";
import type { Collars } from "@/lib/useCollars";
import { fmtDate, fmtNum } from "@/lib/format";
import { Section } from "./Sidebar";

const SEX = { F: "Female", M: "Male", U: "Sex unknown" } as const;

/** Sidebar of the Collared animals view: the individuals and the home-range settings. */
export function CollarSidebar({
  collars,
  swatch,
  speciesNames,
}: {
  collars: Collars;
  swatch: (species: string) => string;
  /** Known species, offered as suggestions when registering an animal. */
  speciesNames: string[];
}) {
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
      {c.canImport && <RegisterIndividual collars={c} speciesNames={speciesNames} />}
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

const EMPTY = { code: "", name: "", species_name: "", sex: "U" as "F" | "M" | "U", collar_id: "" };

/** Researchers and admins register a newly collared animal; its fixes are imported afterwards. */
function RegisterIndividual({ collars, speciesNames }: { collars: Collars; speciesNames: string[] }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  if (!open) {
    return (
      <div className="pad register-toggle">
        <button className="secondary" onClick={() => setOpen(true)}>Register a collared animal</button>
      </div>
    );
  }
  return (
    <Section title="Register a collared animal">
      <form
        className="register-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const ok = await collars.createIndividual({
            code: form.code.trim(),
            species_name: form.species_name.trim(),
            name: form.name.trim() || undefined,
            sex: form.sex,
            collar_id: form.collar_id.trim() || undefined,
          });
          setBusy(false);
          if (ok) {
            setForm(EMPTY);
            setOpen(false);
          }
        }}
      >
        <label className="field">
          Field code
          <input value={form.code} onChange={set("code")} placeholder="e.g. E-031" maxLength={32} required />
        </label>
        <label className="field">
          Species (scientific name)
          <input value={form.species_name} onChange={set("species_name")} list="known-species" maxLength={100} required />
          <datalist id="known-species">
            {speciesNames.map((n) => <option key={n} value={n} />)}
          </datalist>
        </label>
        <label className="field">
          <span>Name <span className="muted">(optional)</span></span>
          <input value={form.name} onChange={set("name")} maxLength={100} />
        </label>
        <div className="register-row">
          <label className="field">
            Sex
            <select value={form.sex} onChange={set("sex")}>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="U">Unknown</option>
            </select>
          </label>
          <label className="field">
            <span>Collar ID <span className="muted">(optional)</span></span>
            <input value={form.collar_id} onChange={set("collar_id")} maxLength={64} />
          </label>
        </div>
        <div className="register-row">
          <button className="primary" disabled={busy}>{busy ? "Registering…" : "Register"}</button>
          <button type="button" className="secondary" onClick={() => setOpen(false)}>Cancel</button>
        </div>
      </form>
    </Section>
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
