import type { WebSocket } from "ws";

/** Fan-out hub that pushes newly ingested observations to connected map clients. */
const clients = new Set<WebSocket>();

export function addClient(socket: WebSocket) {
  clients.add(socket);
  socket.on("close", () => clients.delete(socket));
}

export function broadcast(message: unknown) {
  const payload = JSON.stringify(message);
  for (const socket of clients) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}
