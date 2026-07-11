import type { IncomingMessage, ServerResponse } from "node:http";
import { SessionManager, SessionValidationError } from "./session.js";
import type { PushInput } from "./types.js";

export interface ApiContext {
  manager: SessionManager;
  shutdown: () => void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

/** Returns true if the request matched a route, false to fall through to 404. */
export async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ApiContext
): Promise<boolean> {
  const { pathname } = url;
  if (req.method !== "POST" || !pathname.startsWith("/api/")) return false;

  if (pathname === "/api/shutdown") {
    // Runs the transcript write before responding, so `close` returns once it's on disk.
    ctx.shutdown();
    sendJson(res, 200, { ok: true });
    return true;
  }

  if (pathname === "/api/push") {
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      sendJson(res, 400, { error: "Malformed JSON body." });
      return true;
    }
    const input = body as PushInput;
    try {
      ctx.manager.applyPush(input.replies ?? [], input.addressed ?? []);
      sendJson(res, 200, { ok: true });
    } catch (err) {
      handleError(res, err, "push");
    }
    return true;
  }

  return false;
}

function handleError(res: ServerResponse, err: unknown, label: string): void {
  if (err instanceof SessionValidationError) {
    sendJson(res, 400, { error: err.message });
  } else {
    console.error(`[redline] ${label} failed:`, err);
    sendJson(res, 500, { error: `Internal error handling ${label}.` });
  }
}
