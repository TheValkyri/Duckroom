import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    tanstackStart({
      server: { entry: "server" },
    }),
    viteReact(),
    tailwindcss(),
  ],
  server: {
    // Dev-server hygiene: never expose infrastructure artifacts through the
    // static file path. Verified Stage 2: supabase/*.sql, *.md and lockfiles
    // were otherwise downloadable from the dev origin (localhost by default,
    // but reachable if someone runs `vite dev --host` on an untrusted LAN).
    // Production (nitro preset vercel) ships only dist/client — unaffected.
    fs: {
      deny: [
        "**/*.sql",
        "**/*.md",
        "**/package-lock.json",
        ".env",
        ".env.*",
        // Server-only internals (node:crypto at module scope etc.) must never
        // be directly servable from the dev origin. Client code reaches them
        // exclusively through createServerFn handlers, which are stripped
        // from browser bundles.
        "**/*.server.ts",
      ],
    },
  },
});
