import { createServer as createHttpServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { attachAgentFeed } from "./agent-feed.js";
import { handleApi } from "./api.js";
import type { SessionManager } from "./session.js";
import { serveStatic } from "./static-server.js";
import { attachBrowserFeed } from "./ws-server.js";

export interface RedlineServer {
  server: Server;
  listen(port?: number): Promise<{ port: number }>;
  close(): Promise<void>;
}

export interface RedlineServerOptions {
  manager: SessionManager;
  publicDir: string;
  onShutdownRequest?: () => void;
}

export function createRedlineServer(options: RedlineServerOptions): RedlineServer {
  const { manager, publicDir } = options;

  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url, { manager, shutdown: () => options.onShutdownRequest?.() }).then(
        (handled) => {
          if (!handled) {
            res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ error: "Not Found" }));
          }
        },
        (err: unknown) => {
          console.error("[redline] api error:", err);
          if (!res.headersSent) res.writeHead(500);
          res.end("Internal Server Error");
        }
      );
      return;
    }
    serveStatic(req, res, publicDir).catch((err: unknown) => {
      console.error("[redline] static server error:", err);
      if (!res.headersSent) res.writeHead(500);
      res.end("Internal Server Error");
    });
  });

  const browserWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  attachBrowserFeed(browserWss, manager);
  attachAgentFeed(agentWss, manager);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const wss = pathname === "/ws" ? browserWss : pathname === "/agent" ? agentWss : null;
    if (!wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  return {
    server,
    listen(port = 0) {
      return new Promise((resolve, reject) => {
        const onError = (err: Error) => reject(err);
        server.once("error", onError);
        server.listen(port, "127.0.0.1", () => {
          server.removeListener("error", onError);
          const address = server.address();
          if (address === null || typeof address === "string") {
            reject(new Error("Failed to determine server port"));
            return;
          }
          resolve({ port: address.port });
        });
      });
    },
    close() {
      // An open client would otherwise stall this forever.
      for (const client of browserWss.clients) client.terminate();
      for (const client of agentWss.clients) client.terminate();
      return new Promise((resolve, reject) => {
        browserWss.close(() => {
          agentWss.close(() => {
            server.close((err) => (err ? reject(err) : resolve()));
            server.closeAllConnections();
          });
        });
      });
    },
  };
}
