import { parseArgs } from "@std/cli/parse-args";
import { existsSync } from "@std/fs";
import { join, resolve } from "@std/path";
import { createRedlineServer } from "./src/server.ts";
import { SessionManager } from "./src/session.ts";
import { renderTranscript } from "./src/transcript.ts";
import { watchDocument } from "./src/watcher.ts";
import denoConfig from "./deno.json" with { type: "json" };

const VERSION = denoConfig.version;
const DEFAULT_PORT = 7842;
const rootDir = import.meta.dirname ?? ".";
const publicDir = join(rootDir, "dist", "public");
const bundledSkillPath = join(rootDir, "skill", "SKILL.md");

function homeDir(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
}

function localUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}
function eventsUrl(port: number): string {
  return `ws://127.0.0.1:${port}/agent`;
}

function sidecarPath(docPath: string): string {
  return docPath.endsWith(".md")
    ? `${docPath.slice(0, -3)}.review.md`
    : `${docPath}.review.md`;
}

async function readStdin(): Promise<string> {
  return await new Response(Deno.stdin.readable).text();
}

async function apiPost(
  port: number,
  path: string,
  body?: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(
      `No review running on :${port}. Start one with \`redline open <file>\`.`,
    );
  }
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(
      (parsed as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return parsed;
}

async function cmdOpen(path: string | undefined, port: number): Promise<void> {
  if (!path) {
    fail("open: missing file. Usage: redline open <file.md> [--port <n>]");
  }
  const abs = resolve(path);
  if (!existsSync(abs)) fail(`open: file not found: ${abs}`);

  ensureSkillCurrent();

  const manager = new SessionManager(Deno.readTextFileSync(abs));
  const stopWatching = watchDocument(
    abs,
    (content) => manager.setDocument(content),
  );
  const redline = createRedlineServer({
    manager,
    publicDir,
    onShutdownRequest: shutdown,
  });

  let server: Deno.HttpServer;
  try {
    server = redline.listen(port);
  } catch (err) {
    stopWatching();
    if (err instanceof Deno.errors.AddrInUse) {
      fail(
        `Port :${port} is busy — a review may already be running. Close it, or pass --port <n>.`,
      );
    }
    throw err;
  }

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWatching();
    // Written synchronously, before responding, so `close` only returns once it's on disk.
    try {
      Deno.writeTextFileSync(
        sidecarPath(abs),
        renderTranscript(manager.getState()),
      );
    } catch (err) {
      console.error("[redline] could not write transcript:", err);
    }
    // Deferred a tick so an in-flight /api/shutdown response has time to flush.
    setTimeout(() => {
      redline.closeSockets();
      server.shutdown().finally(() => Deno.exit(0));
    }, 10);
  }

  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    Deno.addSignalListener(sig, shutdown);
  }
  console.log(
    JSON.stringify({
      url: localUrl(port),
      events_url: eventsUrl(port),
      document: abs,
    }),
  );
  await server.finished;
}

async function cmdMonitor(port: number): Promise<void> {
  const ws = new WebSocket(eventsUrl(port));
  ws.addEventListener("message", (event) => console.log(String(event.data)));
  ws.addEventListener("error", () => {
    fail(
      `No review running on :${port}. Start one with \`redline open <file>\`.`,
    );
  });
  await new Promise<void>((res) => ws.addEventListener("close", () => res()));
}

async function cmdPush(port: number): Promise<void> {
  const raw = await readStdin();
  let payload: unknown;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    fail(
      'push: stdin must be JSON like {"replies":[{"to":"f1","content":"…"}],"addressed":["f2"]}.',
    );
  }
  console.log(JSON.stringify(await apiPost(port, "/api/push", payload)));
}

async function cmdClose(port: number): Promise<void> {
  try {
    await apiPost(port, "/api/shutdown");
  } catch {
    // The server closing the connection as it exits is expected here.
  }
  console.log(`Review on :${port} stopped.`);
}

function defaultSkillsDir(): string {
  return join(homeDir(), ".claude", "skills");
}

function skillDir(skillsDir?: string): string {
  return join(skillsDir ?? defaultSkillsDir(), "redline");
}

function writeSkill(dir: string): void {
  Deno.mkdirSync(dir, { recursive: true });
  Deno.writeTextFileSync(
    join(dir, "SKILL.md"),
    Deno.readTextFileSync(bundledSkillPath),
  );
  Deno.writeTextFileSync(join(dir, ".version"), VERSION);
}

function cmdInstallSkill(skillsDir?: string): void {
  const dir = skillDir(skillsDir);
  writeSkill(dir);
  console.log(
    `Installed skill v${VERSION} to ${join(dir, "SKILL.md")}.`,
  );
}

function ensureSkillCurrent(): void {
  try {
    const dir = skillDir();
    if (!existsSync(join(dir, "SKILL.md"))) return;
    const stamp = join(dir, ".version");
    if (existsSync(stamp) && Deno.readTextFileSync(stamp) === VERSION) return;
    writeSkill(dir);
    console.error(`[redline] synced the /redline skill to v${VERSION}.`);
  } catch {
    // Skill sync must never block a review.
  }
}

const USAGE = `Usage: redline <command> [--port <n>]

  open <file.md>    Start a review server watching a markdown file (blocks).
                      Prints { url, events_url, document }. The file is the
                      living document — edit it in place and the UI follows.
  monitor           Stream feedback events live to stdout as NDJSON (blocks).
  push              Post replies / mark change requests addressed (JSON on stdin):
                      {"replies":[{"to":"f1","content":"…"}],"addressed":["f2"]}
  close             Stop the running review (Ctrl-C in its terminal does the same).
  skill [dir]       Install/update the /redline skill for Claude Code. Installs to
                      ~/.claude/skills by default, or into <dir> if given.
  version           Print the redline version. \`open\` also keeps the installed
                      skill in sync with it automatically.

One review runs at a time on a fixed port (default ${DEFAULT_PORT}; override with
--port or REDLINE_PORT). On close, the discussion is saved to <file>.review.md.`;

// Resolves the port for commands that need one. Precedence: --port/-p flag,
// then REDLINE_PORT, then the default.
function resolvePort(flag: string | undefined): number {
  const raw = flag ?? Deno.env.get("REDLINE_PORT") ?? String(DEFAULT_PORT);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    fail(`Invalid port: ${raw}`);
  }
  return port;
}

function fail(message: string): never {
  console.error(message);
  Deno.exit(1);
}

async function main(): Promise<void> {
  const flags = parseArgs(Deno.args, {
    boolean: ["help", "version"],
    string: ["port"],
    alias: { help: "h", version: "v", port: "p" },
  });
  const [command, arg] = flags._.map(String);

  if (flags.version || command === "version") {
    console.log(VERSION);
    return;
  }
  if (flags.help || command === undefined) {
    console.log(USAGE);
    return;
  }

  switch (command) {
    case "open":
      await cmdOpen(arg, resolvePort(flags.port));
      break;
    case "monitor":
      await cmdMonitor(resolvePort(flags.port));
      break;
    case "push":
      await cmdPush(resolvePort(flags.port));
      break;
    case "close":
      await cmdClose(resolvePort(flags.port));
      break;
    case "skill":
      cmdInstallSkill(arg);
      break;
    default:
      console.error(`Unknown command: "${command}"\n\n${USAGE}`);
      Deno.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[redline]", err instanceof Error ? err.message : err);
  Deno.exit(1);
});
