import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      // import.meta.dirname, not __dirname: this file is ESM (.mts). Vite's native
      // config loader warns on both CJS-loaded ESM and __dirname, and becomes the
      // default in a future Vite major.
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    environment: "node",
  },
});
