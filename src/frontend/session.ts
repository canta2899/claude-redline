import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, FeedbackKind, SessionData, ServerMessage } from "../lib/types";

export type ConnStatus = "connecting" | "connected" | "disconnected" | "error";

export interface Session {
  session: SessionData | null;
  conn: ConnStatus;
  addFeedback: (kind: FeedbackKind, content: string, quote?: string) => void;
  reply: (id: string, content: string) => void;
  editComment: (id: string, index: number, content: string) => void;
  remove: (id: string) => void;
  resolve: (id: string) => void;
  reopen: (id: string) => void;
  end: () => void;
}

// No optimistic rendering — each mutation round-trips through the server's echo.
export function useSession(): Session {
  const [session, setSession] = useState<SessionData | null>(null);
  const [conn, setConn] = useState<ConnStatus>("connecting");
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConn("connected");
    ws.onclose = () => setConn("disconnected");
    ws.onerror = () => setConn("error");
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data as string) as ServerMessage;
      if (msg.type === "state") setSession(msg.session);
      else if (msg.type === "error") console.error("[redline]", msg.message);
    };

    return () => ws.close();
  }, []);

  const send = useCallback((m: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  }, []);

  return {
    session,
    conn,
    addFeedback: useCallback(
      (kind, content, quote) => send({ type: "add", kind, content, quote }),
      [send]
    ),
    reply: useCallback((id, content) => send({ type: "reply", id, content }), [send]),
    editComment: useCallback((id, index, content) => send({ type: "edit", id, index, content }), [send]),
    remove: useCallback((id) => send({ type: "delete", id }), [send]),
    resolve: useCallback((id) => send({ type: "resolve", id }), [send]),
    reopen: useCallback((id) => send({ type: "reopen", id }), [send]),
    end: useCallback(() => send({ type: "end" }), [send]),
  };
}
