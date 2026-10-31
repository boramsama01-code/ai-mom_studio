import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@shared": path.resolve(import.meta.dirname, "shared") },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});

