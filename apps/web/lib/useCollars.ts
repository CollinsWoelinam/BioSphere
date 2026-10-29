"use client";

import { useCallback, useEffect, useState } from "react";
import { telemetry, type Individual, type IndividualRange, type SessionUser, type Track } from "./api";

/** Collar telemetry state for staff viewers. Citizens never request it (the API would 403). */
export function useCollars(user: SessionUser) {
  const staff = user.role !== "CITIZEN";
  const [individuals, setIndividuals] = useState<Individual[]>([]);
  const [tracks, setTracks] = useState<Record<string, Track>>({});
  const [ranges, setRanges] = useState<Record<string, IndividualRange>>({});
  const [showOutliers, setShowOutliers] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff) telemetry.individuals().then(setIndividuals).catch((e) => setError(e.message));
  }, [staff]);

  // Selection updates immediately; the track loads in the background.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggleTrack = useCallback(
    async (id: string) => {
      if (selected.has(id)) {
        setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
        setRanges(({ [id]: _, ...rest }) => rest);
        return;
      }
      setSelected((prev) => new Set(prev).add(id));
      if (tracks[id]) return;
      try {
        const t = await telemetry.track(id);
        setTracks((prev) => ({ ...prev, [id]: t }));
      } catch (e) {
        setError((e as Error).message);
        setSelected((prev) => new Set([...prev].filter((x) => x !== id)));
      }
    },
    [selected, tracks],
  );

  const visibleTracks = Object.fromEntries(Object.entries(tracks).filter(([id]) => selected.has(id)));

  const toggleRange = useCallback(
    async (id: string) => {
      if (ranges[id]) return setRanges(({ [id]: _, ...rest }) => rest);
      try {
        const r = await telemetry.homeRange(id);
        setRanges((prev) => ({ ...prev, [id]: r }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [ranges],
  );

  return { staff, individuals, selected, tracks: visibleTracks, ranges, toggleTrack, toggleRange, showOutliers, setShowOutliers, error };
}

export type Collars = ReturnType<typeof useCollars>;
