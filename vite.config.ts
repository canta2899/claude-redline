import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/frontend",
  plugins: [react()],
  build: {
    // Relative to `root` (src/frontend) → repo-root dist/public.
    outDir: "../../dist/public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: "ws://127.0.0.1:5174", ws: true },
    },
  },
});
