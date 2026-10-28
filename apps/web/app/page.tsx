"use client";

import dynamic from "next/dynamic";

// MapLibre and deck.gl need WebGL and `window`, so the workspace renders client-side only.
const Workspace = dynamic(() => import("@/components/Workspace").then((m) => m.Workspace), {
  ssr: false,
  loading: () => <div className="boot muted">Loading BioSphere…</div>,
});

export default function Home() {
  return <Workspace />;
}
