// Runs the real server against a seeded doc so Vite (HMR) can proxy `/ws` to it.

import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRedlineServer } from "./lib/server.js";
import { SessionManager } from "./lib/session.js";
import { watchDocument } from "./lib/watcher.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = join(__dirname, "..");
const dataDir = join(repoRoot, ".dev-data");
const docPath = join(dataDir, "dev-document.md");
const publicDir = join(repoRoot, "dist", "public"); // unused in dev (Vite serves the UI)

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

async function main() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(docPath, EXAMPLE_DOC, "utf8");

  const manager = new SessionManager(readFileSync(docPath, "utf8"));
  const stopWatching = watchDocument(docPath, (content) => manager.setDocument(content));

  const redline = createRedlineServer({ manager, publicDir });
  await redline.listen(BACKEND_PORT);
  process.once("SIGINT", () => stopWatching());
  console.log(`[redline] dev backend on :${BACKEND_PORT} (watching ${docPath})`);
  console.log(`[redline] open: http://localhost:${WEB_PORT}/`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
