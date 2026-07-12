import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function serveStatic(req: IncomingMessage, res: ServerResponse, publicDir: string): Promise<void> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method Not Allowed");
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const root = resolve(publicDir);
  const requested = normalize(join(root, pathname));
  if (requested !== root && !requested.startsWith(root + sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const stats = await stat(requested);
    if (!stats.isFile()) throw new Error("not a file");
    const mime = MIME_TYPES[extname(requested)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": mime, "Content-Length": stats.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(requested).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}
