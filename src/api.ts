import { type SessionManager, SessionValidationError } from "./session.ts";
import type { PushInput } from "./types.ts";

export interface ApiContext {
  manager: SessionManager;
  shutdown: () => void;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

/** Handles the `/api/*` POST routes. Returns a 404 Response for anything unmatched. */
export async function handleApi(
  req: Request,
  url: URL,
  ctx: ApiContext,
): Promise<Response> {
  const { pathname } = url;
  if (req.method !== "POST") return json(404, { error: "Not Found" });

  if (pathname === "/api/shutdown") {
    // Runs the transcript write before responding, so `close` returns once it's on disk.
    ctx.shutdown();
    return json(200, { ok: true });
  }

  if (pathname === "/api/push") {
    let body: PushInput;
    try {
      const raw = (await req.text()).trim();
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return json(400, { error: "Malformed JSON body." });
    }
    try {
      ctx.manager.applyPush(body.replies ?? [], body.addressed ?? []);
      return json(200, { ok: true });
    } catch (err) {
      if (err instanceof SessionValidationError) {
        return json(400, { error: err.message });
      }
      console.error("[redline] push failed:", err);
      return json(500, { error: "Internal error handling push." });
    }
  }

  return json(404, { error: "Not Found" });
}
