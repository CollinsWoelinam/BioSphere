import type { WebSocket } from "ws";
import { seesExactLocations, type Viewer } from "./auth.js";
import { config } from "./config.js";
import type { Sql } from "./db.js";
import { toFeature, type ObservationRow } from "./ingest.js";

/** Fan-out hub that pushes newly ingested observations to connected map clients. */
const clients = new Map<WebSocket, Viewer>();

export function addClient(socket: WebSocket, viewer: Viewer) {
  clients.set(socket, viewer);
  socket.on("close", () => clients.delete(socket));
}

// Same rounding as PostGIS ST_SnapToGrid, so live and REST views agree.
const snap = (x: number) => Math.round(x / config.sensitiveGridDeg) * config.sensitiveGridDeg;

function generalize(r: ObservationRow): ObservationRow {
  return { ...r, lon: snap(r.lon), lat: snap(r.lat), accuracy_m: null, habitat_notes: null, generalized: true };
}

export async function broadcastObservations(sql: Sql, rows: ObservationRow[]) {
  if (!clients.size || !rows.length) return;
  const sensitive = new Set(
    (await sql<{ species_name: string }[]>`SELECT species_name FROM species WHERE is_sensitive`).map((r) => r.species_name),
  );
  const exact = JSON.stringify({ type: "observations.created", features: rows.map(toFeature) });
  const restricted = JSON.stringify({
    type: "observations.created",
    features: rows.map((r) => toFeature(sensitive.has(r.species_name) ? generalize(r) : r)),
  });
  for (const [socket, viewer] of clients) {
    if (socket.readyState === socket.OPEN) socket.send(seesExactLocations(viewer) ? exact : restricted);
  }
}
