#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { createRedlineServer } from "./lib/server.js";
import { SessionManager } from "./lib/session.js";
import { renderTranscript } from "./lib/transcript.js";
import { watchDocument } from "./lib/watcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// dist/cli.js and dist/public sit side by side after `vite build`.
const publicDir = join(__dirname, "public");
// dist/cli.js and skill/ sit side by side in the published package.
const bundledSkillPath = join(__dirname, "..", "skill", "SKILL.md");

const DEFAULT_PORT = 7842;

function localUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}
function eventsUrl(port: number): string {
  return `ws://127.0.0.1:${port}/agent`;
}

function sidecarPath(docPath: string): string {
  return docPath.endsWith(".md") ? `${docPath.slice(0, -3)}.review.md` : `${docPath}.review.md`;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function apiPost(port: number, path: string, body?: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    fail(`No review running on :${port}. Start one with \`redline open <file>\`.`);
  }
  const text = await res.text();
  const parsed: unknown = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error((parsed as { error?: string }).error ?? `HTTP ${res.status}`);
  return parsed;
}

async function cmdOpen(path: string | undefined, port: number): Promise<void> {
  if (!path) fail("open: missing file. Usage: redline open <file.md> [--port <n>]");
  const abs = resolve(path);
  if (!existsSync(abs)) fail(`open: file not found: ${abs}`);

  const manager = new SessionManager(readFileSync(abs, "utf8"));
  const stopWatching = watchDocument(abs, (content) => manager.setDocument(content));
  const redline = createRedlineServer({ manager, publicDir, onShutdownRequest: shutdown });

  let shuttingDown = false;
  function shutdown(): void {
    if (shuttingDown) return;
    shuttingDown = true;
    stopWatching();
    // Written synchronously, before responding, so `close` only returns once it's on disk.
    try {
      writeFileSync(sidecarPath(abs), renderTranscript(manager.getState()));
    } catch (err) {
      console.error("[redline] could not write transcript:", err);
    }
    // Deferred a tick so an in-flight /api/shutdown response has time to flush.
    setTimeout(() => redline.close().finally(() => process.exit(0)), 10);
  }

  try {
    await redline.listen(port);
  } catch (err) {
    stopWatching();
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      fail(`Port :${port} is busy — a review may already be running. Close it, or pass --port <n>.`);
    }
    throw err;
  }
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  process.once("SIGHUP", shutdown);
  console.log(JSON.stringify({ url: localUrl(port), events_url: eventsUrl(port), document: abs }));
  await new Promise<void>(() => {});
}

async function cmdMonitor(port: number): Promise<void> {
  const ws = new WebSocket(eventsUrl(port));
  ws.on("message", (raw: Buffer) => process.stdout.write(`${raw.toString("utf8")}\n`));
  ws.on("error", () => fail(`No review running on :${port}. Start one with \`redline open <file>\`.`));
  await new Promise<void>((res) => ws.on("close", () => res()));
}

async function cmdPush(port: number): Promise<void> {
  const raw = await readStdin();
  let payload: unknown;
  try {
    payload = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    fail('push: stdin must be JSON like {"replies":[{"to":"f1","content":"…"}],"addressed":["f2"]}.');
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

const skillTargetPath = join(homedir(), ".claude", "skills", "redline", "SKILL.md");

function cmdAddSkill(): void {
  mkdirSync(dirname(skillTargetPath), { recursive: true });
  writeFileSync(skillTargetPath, readFileSync(bundledSkillPath, "utf8"));
  console.log(`Installed skill to ${skillTargetPath} (invoke with /redline, no restart needed).`);
}

// Keeps a previously-installed skill copy current with the CLI's own version,
// so there's no separate "update the skill" step to remember.
function syncInstalledSkill(): void {
  try {
    if (!existsSync(skillTargetPath)) return;
    const bundled = readFileSync(bundledSkillPath, "utf8");
    if (readFileSync(skillTargetPath, "utf8") !== bundled) {
      writeFileSync(skillTargetPath, bundled);
    }
  } catch {
    // Best-effort — never block the actual command over this.
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
  add-skill         Install the /redline skill for Claude Code (~/.claude/skills).

One review runs at a time on a fixed port (default ${DEFAULT_PORT}; override with
--port or REDLINE_PORT). On close, the discussion is saved to <file>.review.md.
If the skill is already installed, every command silently keeps it in sync with
this CLI's version.`;

function parseArgs(argv: string[]): { positional: string[]; port: number } {
  const positional: string[] = [];
  let port = process.env.REDLINE_PORT ? Number(process.env.REDLINE_PORT) : DEFAULT_PORT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port" || a === "-p") port = Number(argv[++i]);
    else if (a?.startsWith("--port=")) port = Number(a.slice("--port=".length));
    else if (a !== undefined) positional.push(a);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) fail(`Invalid port: ${port}`);
  return { positional, port };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  syncInstalledSkill();
  if (command === "add-skill") {
    cmdAddSkill();
    return;
  }
  const { positional, port } = parseArgs(rest);
  const [arg] = positional;
  switch (command) {
    case "open":
      await cmdOpen(arg, port);
      break;
    case "monitor":
      await cmdMonitor(port);
      break;
    case "push":
      await cmdPush(port);
      break;
    case "close":
      await cmdClose(port);
      break;
    default:
      console.error(command ? `Unknown command: "${command}"\n\n${USAGE}` : USAGE);
      process.exit(command ? 1 : 0);
  }
}

main().catch((err: unknown) => {
  console.error("[redline]", err instanceof Error ? err.message : err);
  process.exit(1);
});
