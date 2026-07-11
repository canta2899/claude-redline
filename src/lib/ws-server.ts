import { WebSocket, WebSocketServer } from "ws";
import { SessionManager, SessionValidationError } from "./session.js";
import type { ClientMessage, ServerMessage } from "./types.js";

/** The `/ws` endpoint: every connected tab gets the full session state on connect and on every change. */
export function attachBrowserFeed(wss: WebSocketServer, manager: SessionManager): void {
  const clients = new Set<WebSocket>();

  const broadcast = () => {
    const payload = JSON.stringify({ type: "state", session: manager.getState() } satisfies ServerMessage);
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  };
  manager.on("change", broadcast);

  wss.on("connection", (ws: WebSocket) => handleConnection(ws));

  function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  function handleConnection(ws: WebSocket): void {
    clients.add(ws);
    send(ws, { type: "state", session: manager.getState() });

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(ws, { type: "error", message: "Malformed JSON message" });
        return;
      }
      void dispatch(message).catch((err: unknown) => {
        const text = err instanceof SessionValidationError ? err.message : "Internal error handling message";
        send(ws, { type: "error", message: text });
      });
    });

    ws.on("close", () => clients.delete(ws));
  }

  async function dispatch(message: ClientMessage): Promise<void> {
    switch (message.type) {
      case "add":
        await manager.addFeedback(message.kind, message.content, message.quote);
        break;
      case "reply":
        await manager.reply(message.id, message.content);
        break;
      case "edit":
        await manager.editComment(message.id, message.index, message.content);
        break;
      case "delete":
        await manager.deleteFeedback(message.id);
        break;
      case "resolve":
        await manager.resolve(message.id);
        break;
      case "reopen":
        await manager.reopen(message.id);
        break;
      case "end":
        await manager.end();
        break;
      default:
        throw new SessionValidationError(`Unknown message type: "${(message as { type: string }).type}"`);
    }
  }
}
