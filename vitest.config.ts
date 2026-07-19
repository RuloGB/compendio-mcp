import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Native modules (better-sqlite3) are loaded once per worker; forks are
    // the stable pool for native addons on Windows.
    pool: "forks",
    testTimeout: 20000,
  },
});
