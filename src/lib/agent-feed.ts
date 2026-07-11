import { WebSocket, WebSocketServer } from "ws";
import type { SessionManager } from "./session.js";
import type { AgentEvent } from "./types.js";

/** The `/agent` endpoint: pushes a `pull()` delta whenever there's new feedback to act on. */
export function attachAgentFeed(wss: WebSocketServer, manager: SessionManager): void {
  const clients = new Set<WebSocket>();

  // Chained so overlapping "change" events can't compute overlapping deltas
  // against the shared pulled_rev watermark.
  let queue: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    queue = queue.then(async () => {
      const delta = manager.pull();
      if (delta.status !== "closed" && delta.feedback.length === 0) return;
      const frame = JSON.stringify({ type: "review-requested", ...delta } satisfies AgentEvent);
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    });
    return queue;
  };

  manager.on("change", () => void flush());

  wss.on("connection", (ws: WebSocket) => {
    clients.add(ws);
    ws.on("close", () => clients.delete(ws));
    void flush();
  });
}
