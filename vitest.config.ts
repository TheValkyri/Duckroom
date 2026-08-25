import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Explicit Vitest configuration.
 *
 * Previously the suite ran on Vitest defaults by implicitly reading
 * vite.config.ts (whose plugins target app build/dev, not tests). This file
 * makes the contract explicit: Node environment, unit/integration suites in
 * src/test, no SSR/app plugins, and the "@/..." path alias resolved for any
 * future test that imports shared modules through it.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/test/**/*.test.ts"],
    globals: false,
    // Keep unhandled rejections visible: a rejected server-fn promise must
    // fail the run instead of disappearing (fail-closed testing posture).
    dangerouslyIgnoreUnhandledErrors: false,
  },
});
