// Bundles the MCP server entry (src/cli.ts + everything it imports from
// src/lib) into a single ESM file at dist/cli.js. Node built-ins and the
// runtime deps (declared in package.json "dependencies") stay external —
// they're resolved from node_modules at runtime, exactly like an installed
// npm package. The frontend is bundled separately by `vite build`.

import { build } from "esbuild";
import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const external = Object.keys(pkg.dependencies ?? {});

await build({
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  // TS NodeNext code imports with `.js` specifiers that actually resolve to
  // `.ts` files; this teaches esbuild's resolver that mapping.
  resolveExtensions: [".ts", ".js", ".json"],
  external,
  logLevel: "info",
});

await chmod("dist/cli.js", 0o755);
console.log("[build-server] wrote dist/cli.js");
