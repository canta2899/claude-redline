import { type SessionManager, SessionValidationError } from "./session.ts";
import type { ClientMessage, ServerMessage } from "./types.ts";

export interface Feed {
  /** Upgrades the request to a WebSocket and wires it into the feed. */
  handleUpgrade(req: Request): Response;
  /** Closes every connected socket (used on shutdown). */
  closeAll(): void;
}

/** The `/ws` endpoint: every connected tab gets the full session state on connect and on every change. */
export function createBrowserFeed(manager: SessionManager): Feed {
  const clients = new Set<WebSocket>();

  manager.on("change", () => {
    const payload = JSON.stringify(
      { type: "state", session: manager.getState() } satisfies ServerMessage,
    );
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  });

  function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function handleUpgrade(req: Request): Response {
    const { socket, response } = Deno.upgradeWebSocket(req);

    socket.addEventListener("open", () => {
      clients.add(socket);
      send(socket, { type: "state", session: manager.getState() });
    });

    socket.addEventListener("message", (event) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(event.data) as ClientMessage;
      } catch {
        send(socket, { type: "error", message: "Malformed JSON message" });
        return;
      }
      void dispatch(message).catch((err: unknown) => {
        const text = err instanceof SessionValidationError
          ? err.message
          : "Internal error handling message";
        send(socket, { type: "error", message: text });
      });
    });

    socket.addEventListener("close", () => clients.delete(socket));

    return response;
  }

  function dispatch(message: ClientMessage): Promise<void> {
    return Promise.resolve().then(() => {
      switch (message.type) {
        case "add":
          manager.addFeedback(message.kind, message.content, message.quote);
          break;
        case "reply":
          manager.reply(message.id, message.content);
          break;
        case "edit":
          manager.editComment(message.id, message.index, message.content);
          break;
        case "delete":
          manager.deleteFeedback(message.id);
          break;
        case "resolve":
          manager.resolve(message.id);
          break;
        case "reopen":
          manager.reopen(message.id);
          break;
        case "end":
          manager.end();
          break;
        default:
          throw new SessionValidationError(
            `Unknown message type: "${(message as { type: string }).type}"`,
          );
      }
    });
  }

  return {
    handleUpgrade,
    closeAll: () => {
      for (const ws of clients) ws.close();
    },
  };
}
