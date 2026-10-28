"use client";

import { useEffect, useState } from "react";
import type { Mode } from "./colors";

/** Tracks the OS color scheme so deck.gl layers pick the matching palette steps. */
export function useColorMode(): Mode {
  const [mode, setMode] = useState<Mode>("light");
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setMode(mq.matches ? "dark" : "light");
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return mode;
}
