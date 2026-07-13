// Runs the real server against a seeded doc so Vite (HMR) can proxy `/ws` to it.

import { join } from "@std/path";
import { createRedlineServer } from "./server.ts";
import { SessionManager } from "./session.ts";
import { watchDocument } from "./watcher.ts";

const rootDir = join(import.meta.dirname ?? ".", "..");
const dataDir = join(rootDir, ".dev-data");
const docPath = join(dataDir, "dev-document.md");
const publicDir = join(rootDir, "dist", "public"); // unused in dev (Vite serves the UI)

const BACKEND_PORT = 5174;
const WEB_PORT = 5173;

const EXAMPLE_DOC = `# Review of the auth refactor

Overall this looks solid. A few things stood out:

- The token refresh logic retries indefinitely on a 401, which could spin forever if the refresh token itself is invalid.
- \`validateSession\` is called twice on the hot path — once in the middleware, once again in the handler.
- Consider extracting the retry/backoff logic into its own module; it's duplicated in three places now.

\`\`\`ts
async function refresh(token: string) {
  while (true) {
    const res = await fetch("/refresh", { body: token });
    if (res.ok) return res.json();
  }
}
\`\`\`

Falls back to the cached session if the refresh network call fails outright, which seems reasonable.
`;

await Deno.mkdir(dataDir, { recursive: true });
await Deno.writeTextFile(docPath, EXAMPLE_DOC);

const manager = new SessionManager(Deno.readTextFileSync(docPath));
const stopWatching = watchDocument(
  docPath,
  (content) => manager.setDocument(content),
);

const redline = createRedlineServer({ manager, publicDir });
redline.listen(BACKEND_PORT);
Deno.addSignalListener("SIGINT", () => {
  stopWatching();
  Deno.exit(0);
});
console.log(`[redline] dev backend on :${BACKEND_PORT} (watching ${docPath})`);
console.log(`[redline] open: http://localhost:${WEB_PORT}/`);
