"use client";

import { useEffect, useState } from "react";
import { api, type Photo, type Sighting } from "@/lib/api";
import { fmtNum } from "@/lib/format";

/** Loads an authenticated image and revokes its blob URL when unmounted. */
function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    api
      .photoBlobUrl(path)
      .then((u) => {
        url = u;
        if (!cancelled) setSrc(u);
        else URL.revokeObjectURL(u);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (failed) return <div className={`${className ?? ""} photo-missing muted`}>Unavailable</div>;
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`${className ?? ""} photo-loading`} />;
}

export function SightingPanel({ sighting, swatch, onClose }: { sighting: Sighting; swatch: string; onClose: () => void }) {
  const [photos, setPhotos] = useState<Photo[] | null>(null);
  const [enlarged, setEnlarged] = useState<Photo | null>(null);
  const s = sighting;

  useEffect(() => {
    setPhotos(null);
    setEnlarged(null);
    if (!s.photo_count) return setPhotos([]);
    api.photos(s.id).then(setPhotos).catch(() => setPhotos([]));
  }, [s.id, s.photo_count]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (enlarged ? setEnlarged(null) : onClose());
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enlarged, onClose]);

  return (
    <aside className="sighting-panel" aria-label="Sighting details">
      <header>
        <span className="swatch" style={{ background: swatch }} aria-hidden />
        <h3><i>{s.species}</i></h3>
        <button className="ghost" onClick={onClose} aria-label="Close">×</button>
      </header>
      <dl>
        <dt>Observed</dt><dd>{new Date(s.t).toLocaleString()}</dd>
        <dt>Count</dt><dd>{fmtNum(s.individual_count)}</dd>
        <dt>Observer</dt><dd>{s.observer_type === "RANGER" ? "Ranger" : "Citizen scientist"}</dd>
        <dt>Position</dt>
        <dd>
          {s.position[1].toFixed(s.generalized ? 1 : 5)}, {s.position[0].toFixed(s.generalized ? 1 : 5)}
          {s.generalized ? " (generalised ~11 km)" : s.accuracy_m != null ? ` ±${fmtNum(s.accuracy_m, 1)} m` : ""}
        </dd>
        {s.habitat_notes && (<><dt>Notes</dt><dd>{s.habitat_notes}</dd></>)}
      </dl>
      {!!s.photo_count && (
        <div className="photo-grid">
          {photos === null && <p className="muted small">Loading photos…</p>}
          {photos?.map((p) => (
            <button key={p.id} className="photo-thumb" onClick={() => setEnlarged(p)} aria-label="Enlarge photo">
              <AuthImage path={p.thumb_url} alt={`Photo of ${s.species}`} />
            </button>
          ))}
        </div>
      )}
      {enlarged && (
        <div className="lightbox" role="dialog" aria-label="Photo" onClick={() => setEnlarged(null)}>
          <AuthImage path={enlarged.url} alt={`Photo of ${s.species}`} className="lightbox-img" />
        </div>
      )}
    </aside>
  );
}
