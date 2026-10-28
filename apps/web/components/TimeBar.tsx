"use client";

import { useMemo, useRef, useState } from "react";
import type { Sighting } from "@/lib/api";
import { fmtDate, fmtNum } from "@/lib/format";
import { DAY } from "@/lib/format";

interface Props {
  sightings: Sighting[];
  domain: [number, number];
  cursor: number;
  windowStart: number;
  onCursorChange: (t: number) => void;
  playing: boolean;
  onTogglePlay: () => void;
  speed: number;
  onSpeedChange: (n: number) => void;
  windowDays: number;
  onWindowDaysChange: (n: number) => void;
  visibleCount: number;
}

const WIDTH = 1000;
const HEIGHT = 56;
const WEEK = 7 * DAY;

export function TimeBar(p: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number } | null>(null);
  const [t0, t1] = p.domain;
  const span = Math.max(t1 - t0, DAY);
  const x = (t: number) => ((t - t0) / span) * WIDTH;

  const bins = useMemo(() => {
    const n = Math.max(1, Math.ceil(span / WEEK));
    const counts = new Array<number>(n).fill(0);
    for (const s of p.sightings) counts[Math.min(n - 1, Math.floor((s.t - t0) / WEEK))]++;
    return counts;
  }, [p.sightings, t0, span]);
  const max = Math.max(1, ...bins);
  const barW = (WEEK / span) * WIDTH;

  const scrub = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    p.onCursorChange(t0 + f * span);
  };

  return (
    <section className="timebar" aria-label="Temporal migration animator">
      <div className="timebar-controls">
        <button className="play" onClick={p.onTogglePlay} aria-label={p.playing ? "Pause" : "Play"}>
          {p.playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 2.5v11a.5.5 0 0 0 .77.42l8.5-5.5a.5.5 0 0 0 0-.84l-8.5-5.5A.5.5 0 0 0 4 2.5Z" /></svg>
          )}
        </button>
        <div className="time-readout">
          <strong>{fmtDate(p.cursor)}</strong>
          <span className="muted">
            {p.windowDays ? `${fmtDate(p.windowStart)} – ` : "All sightings to date · "}
            {fmtNum(p.visibleCount)} shown
          </span>
        </div>
        <label className="inline-field">
          Window
          <select value={p.windowDays} onChange={(e) => p.onWindowDaysChange(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={0}>Cumulative</option>
          </select>
        </label>
        <label className="inline-field">
          Speed
          <select value={p.speed} onChange={(e) => p.onSpeedChange(Number(e.target.value))}>
            <option value={3}>3 days/s</option>
            <option value={10}>10 days/s</option>
            <option value={30}>30 days/s</option>
            <option value={60}>60 days/s</option>
          </select>
        </label>
      </div>

      <div className="timebar-chart">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          role="slider"
          tabIndex={0}
          aria-label="Time cursor"
          aria-valuemin={t0}
          aria-valuemax={t1}
          aria-valuenow={p.cursor}
          aria-valuetext={fmtDate(p.cursor)}
          onPointerDown={(e) => {
            (e.target as Element).setPointerCapture(e.pointerId);
            scrub(e.clientX);
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) scrub(e.clientX);
            const r = svgRef.current!.getBoundingClientRect();
            const i = Math.floor(((e.clientX - r.left) / r.width) * span / WEEK);
            setHover(i >= 0 && i < bins.length ? { i, x: e.clientX - r.left } : null);
          }}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") p.onCursorChange(Math.min(t1, p.cursor + (e.shiftKey ? WEEK : DAY)));
            if (e.key === "ArrowLeft") p.onCursorChange(Math.max(t0, p.cursor - (e.shiftKey ? WEEK : DAY)));
          }}
        >
          <rect className="window" x={x(Math.max(t0, p.windowStart))} y={0} width={Math.max(2, x(p.cursor) - x(Math.max(t0, p.windowStart)))} height={HEIGHT} />
          {bins.map((c, i) => {
            const h = (c / max) * (HEIGHT - 6);
            const bx = i * barW + 1;
            const inWindow = t0 + (i + 1) * WEEK > p.windowStart && t0 + i * WEEK <= p.cursor;
            return (
              <rect
                key={i}
                className={`bar${inWindow ? " active" : ""}${hover?.i === i ? " hover" : ""}`}
                x={bx}
                y={HEIGHT - h}
                width={Math.max(1, barW - 2)}
                height={h}
                rx={2}
              />
            );
          })}
          <line className="baseline" x1={0} x2={WIDTH} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} />
          <line className="cursor" x1={x(p.cursor)} x2={x(p.cursor)} y1={0} y2={HEIGHT} vectorEffect="non-scaling-stroke" />
        </svg>
        {hover && (
          <div className="bar-tooltip" style={{ left: hover.x }}>
            <span className="muted">Week of {fmtDate(t0 + hover.i * WEEK)}</span>
            <b>{fmtNum(bins[hover.i])} sightings</b>
          </div>
        )}
        <div className="axis">
          <span>{fmtDate(t0)}</span>
          <span>{fmtDate(t0 + span / 2)}</span>
          <span>{fmtDate(t1)}</span>
        </div>
      </div>
    </section>
  );
}
