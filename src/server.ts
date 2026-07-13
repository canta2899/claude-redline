import { handleApi } from "./api.ts";
import { createAgentFeed } from "./agent-feed.ts";
import { createBrowserFeed } from "./browser-feed.ts";
import type { SessionManager } from "./session.ts";
import { serveStatic } from "./static.ts";

export interface RedlineServer {
  /** Starts listening on 127.0.0.1:port. Throws Deno.errors.AddrInUse if taken. */
  listen(port: number): Deno.HttpServer;
  /** Closes every live WebSocket. Call before the HttpServer's own shutdown. */
  closeSockets(): void;
}

export interface RedlineServerOptions {
  manager: SessionManager;
  publicDir: string;
  onShutdownRequest?: () => void;
}

export function createRedlineServer(
  options: RedlineServerOptions,
): RedlineServer {
  const { manager, publicDir } = options;

  const browser = createBrowserFeed(manager);
  const agent = createAgentFeed(manager);

  const handler = (req: Request): Response | Promise<Response> => {
    const url = new URL(req.url);
    if (url.pathname === "/ws") return browser.handleUpgrade(req);
    if (url.pathname === "/agent") return agent.handleUpgrade(req);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(req, url, {
        manager,
        shutdown: () => options.onShutdownRequest?.(),
      });
    }
    return serveStatic(url, publicDir);
  };

  return {
    listen(port) {
      return Deno.serve(
        { port, hostname: "127.0.0.1", onListen: () => {} },
        handler,
      );
    },
    closeSockets() {
      browser.closeAll();
      agent.closeAll();
    },
  };
}
