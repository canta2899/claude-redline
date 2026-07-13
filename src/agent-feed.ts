import type { SessionManager } from "./session.ts";
import type { AgentEvent } from "./types.ts";
import type { Feed } from "./browser-feed.ts";

/** The `/agent` endpoint: pushes a `pull()` delta whenever there's new feedback to act on. */
export function createAgentFeed(manager: SessionManager): Feed {
  const clients = new Set<WebSocket>();

  // Chained so overlapping "change" events can't compute overlapping deltas
  // against the shared pulled_rev watermark.
  let queue: Promise<void> = Promise.resolve();
  const flush = (): Promise<void> => {
    queue = queue.then(() => {
      const delta = manager.pull();
      if (delta.status !== "closed" && delta.feedback.length === 0) return;
      const frame = JSON.stringify(
        { type: "review-requested", ...delta } satisfies AgentEvent,
      );
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(frame);
      }
    });
    return queue;
  };

  manager.on("change", () => void flush());

  function handleUpgrade(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);
    socket.addEventListener("open", () => {
      clients.add(socket);
      void flush();
    });
    socket.addEventListener("close", () => clients.delete(socket));
    return response;
  }

  return {
    handleUpgrade,
    closeAll: () => {
      for (const ws of clients) ws.close();
    },
  };
}
