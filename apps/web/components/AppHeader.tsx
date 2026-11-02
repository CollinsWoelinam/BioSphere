"use client";

import type { SessionUser } from "@/lib/api";

export type View = "map" | "collars" | "admin";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * Top bar shared by every portal screen. Inside the workspace, Map and Collared animals
 * switch views in place (`onNavigate`) so the map keeps its state; elsewhere they are links.
 */
export function AppHeader({
  user,
  view,
  onNavigate,
  onSignOut,
  liveConnected,
}: {
  user: SessionUser;
  view: View;
  onNavigate?: (v: "map" | "collars") => void;
  onSignOut: () => void;
  liveConnected?: boolean;
}) {
  const item = (v: View, label: string, href: string) => (
    <a
      key={v}
      href={href}
      className={view === v ? "on" : undefined}
      aria-current={view === v ? "page" : undefined}
      onClick={(e) => {
        if (onNavigate && v !== "admin") {
          e.preventDefault();
          onNavigate(v);
        }
      }}
    >
      {label}
    </a>
  );

  return (
    <header className="app-header">
      <a className="logo" href="/" aria-label="BioSphere home">
        <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
          <circle cx="16" cy="16" r="15" fill="var(--accent)" />
          <path d="M6 19c4-1 6-6 10-6s6 5 10 6" fill="none" stroke="#b8e3c9" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M9 23c3-.6 5-3 7-3s4 2.4 7 3" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span>BioSphere</span>
      </a>
      <nav className="app-nav" aria-label="Portal">
        {item("map", "Map", "/")}
        {user.role !== "CITIZEN" && item("collars", "Collared animals", "/?view=collars")}
        {user.role === "ADMIN" && item("admin", "Admin", "/admin")}
      </nav>
      <div className="app-header-end">
        {liveConnected !== undefined && (
          <span className={`live ${liveConnected ? "on" : "off"}`} title={liveConnected ? "Receiving field sightings live" : "Live feed disconnected"}>
            <span className="dot" aria-hidden />
            {liveConnected ? "Live" : "Offline"}
          </span>
        )}
        <span className="account-chip">
          <span className="avatar" aria-hidden>{initials(user.name)}</span>
          <span className="account-text">
            <span className="account-name">{user.name}</span>
            <span className="role">{user.role}</span>
          </span>
        </span>
        <button className="secondary" onClick={onSignOut}>Sign out</button>
      </div>
    </header>
  );
}
