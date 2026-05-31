import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@gba/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // Emulator-backed integration tests (*.itest.ts) run via the separate
    // vitest.integration.config.ts under `firebase emulators:exec` — exclude
    // them from the default unit run so `npm test` needs no emulator.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.itest.ts"],
  },
});
