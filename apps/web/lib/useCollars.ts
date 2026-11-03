"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { telemetry, type Individual, type IndividualRange, type RangeMethod, type SessionUser, type Track } from "./api";

/** Collar telemetry state for staff viewers. Citizens never request it (the API would 403). */
export function useCollars(user: SessionUser) {
  const staff = user.role !== "CITIZEN";
  const canImport = user.role === "ADMIN" || user.role === "RESEARCHER";
  const [individuals, setIndividuals] = useState<Individual[]>([]);
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [ranges, setRanges] = useState<Record<string, IndividualRange>>({});
  const [showOutliers, setShowOutliers] = useState(false);
  const [rangeMethod, setRangeMethodState] = useState<RangeMethod>("kde");
  const [hScale, setHScaleState] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadIndividuals = useCallback(
    () => telemetry.individuals().then(setIndividuals).catch((e) => setError(e.message)),
    [],
  );
  useEffect(() => {
    if (staff) loadIndividuals();
  }, [staff, loadIndividuals]);

  // Selection updates immediately; the track loads in the background.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** The individual whose details the Collared animals view shows. */
  const [focused, setFocused] = useState<string | null>(null);

  const loadTrack = useCallback(async (id: string) => {
    const t = await telemetry.track(id);
    setTracks((prev) => ({ ...prev, [id]: t }));
  }, []);

  const toggleTrack = useCallback(
    async (id: string) => {
      if (selected.has(id)) {
        setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
        setRanges(({ [id]: _, ...rest }) => rest);
        setFocused((f) => (f === id ? null : f));
        return;
      }
      setSelected((prev) => new Set(prev).add(id));
      setFocused(id);
      if (tracks[id]) return;
      try {
        await loadTrack(id);
      } catch (e) {
        setError((e as Error).message);
        setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
      }
    },
    [selected, tracks, loadTrack],
  );

  const visibleTracks = Object.fromEntries(Object.entries(tracks).filter(([id]) => selected.has(id)));

  const toggleRange = useCallback(
    async (id: string) => {
      if (ranges[id]) return setRanges(({ [id]: _, ...rest }) => rest);
      try {
        const r = await telemetry.homeRange(id, rangeMethod, hScale);
        setRanges((prev) => ({ ...prev, [id]: r }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ranges, rangeMethod, hScale],
  );

  /** Recomputes every range currently shown with new settings. */
  const recompute = useCallback(
    async (m: RangeMethod, h: number) => {
      const ids = Object.keys(ranges);
      try {
        const next = await Promise.all(ids.map(async (id) => [id, await telemetry.homeRange(id, m, h)] as const));
        setRanges(Object.fromEntries(next));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ranges],
  );
  const setRangeMethod = useCallback(
    (m: RangeMethod) => {
      setRangeMethodState(m);
      return recompute(m, hScale);
    },
    [recompute, hScale],
  );
  /**
   * Bandwidth multiplier on h_ref; only affects KDE ranges. The slider updates at once, but
   * ranges are recomputed only once dragging pauses, not for every step.
   */
  const hTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const setHScale = useCallback(
    (h: number) => {
      setHScaleState(h);
      clearTimeout(hTimer.current);
      if (rangeMethod === "kde") hTimer.current = setTimeout(() => recompute(rangeMethod, h), 350);
    },
    [recompute, rangeMethod],
  );
  useEffect(() => () => clearTimeout(hTimer.current), []);

  /** Registers a newly collared animal (researchers and admins) and selects it. */
  const createIndividual = useCallback(
    async (ind: Parameters<typeof telemetry.createIndividual>[0]) => {
      setError(null);
      setNotice(null);
      try {
        const created = await telemetry.createIndividual(ind);
        await loadIndividuals();
        setFocused(created.id);
        setNotice(`Registered ${created.code}. Import its collar data to see its track.`);
        return true;
      } catch (e) {
        setError((e as Error).message);
        return false;
      }
    },
    [loadIndividuals],
  );

  const importFixes = useCallback(
    async (id: string, file: File) => {
      setError(null);
      setNotice(null);
      try {
        const r = await telemetry.importFixes(id, await file.text());
        setNotice(
          `Imported ${r.inserted} fix${r.inserted === 1 ? "" : "es"}` +
            (r.duplicates ? `, ${r.duplicates} already stored` : "") +
            (r.rejected ? `, ${r.rejected} rejected` : ""),
        );
        await loadIndividuals();
        // Show the (new or extended) track straight away, even for a just-registered animal.
        setSelected((prev) => new Set(prev).add(id));
        await loadTrack(id);
        if (ranges[id]) setRanges({ ...ranges, [id]: await telemetry.homeRange(id, rangeMethod, hScale) });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [loadIndividuals, loadTrack, ranges, rangeMethod, hScale],
  );

  return {
    staff,
    canImport,
    individuals,
    selected,
    focused,
    setFocused,
    tracks: visibleTracks,
    ranges,
    toggleTrack,
    toggleRange,
    rangeMethod,
    setRangeMethod,
    hScale,
    setHScale,
    showOutliers,
    setShowOutliers,
    importFixes,
    createIndividual,
    error,
    notice,
  };
}

export type Collars = ReturnType<typeof useCollars>;
