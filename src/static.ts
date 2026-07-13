import { contentType } from "@std/media-types";
import { extname, join, normalize, resolve, SEPARATOR } from "@std/path";

// Serves the built Vite SPA. In a `deno compile` binary the files live in the
// embedded virtual filesystem (see the `--include dist/public` compile flag),
// and the same Deno.readFile path reads them there as it does on disk in dev.
export async function serveStatic(
  url: URL,
  publicDir: string,
): Promise<Response> {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";

  const root = resolve(publicDir);
  const requested = normalize(join(root, pathname));
  if (requested !== root && !requested.startsWith(root + SEPARATOR)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const data = await Deno.readFile(requested);
    const mime = contentType(extname(requested)) ?? "application/octet-stream";
    return new Response(data, { headers: { "content-type": mime } });
  } catch {
    return new Response("Not Found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }
}
