/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // server/db.ts closeDb() forces a GC so libSQL releases temp database files on
    // Windows; the tests delete those files right after closing them.
    pool: "forks",
    // Several suites build the 1,000-case demo state in beforeAll. With one fork per core
    // they starve each other and hit the default 10 s hook timeout (seen on a 14-core
    // machine in the TICKET-23 check), so forks are capped and timeouts raised.
    poolOptions: { forks: { execArgv: ["--expose-gc"], maxForks: 4, minForks: 1 } },
    hookTimeout: 60_000,
    testTimeout: 60_000,
    // Agent worktrees live under .claude/ and carry their own copies of the tests.
    exclude: ["**/node_modules/**", "**/dist/**", ".claude/**", "arsip-itmam/**"],
  },
  server: {
    // Only the frontend needs watching. PowerPoint's temp files in docs/deck (EBUSY on
    // Windows) and the agent worktrees otherwise crash the dev server's watcher.
    watch: { ignored: ["**/docs/**", "**/tools/**", "**/.claude/**", "**/arsip-itmam/**", "**/data/**"] },
    // The API lives in its own process on 3001 (server/index.ts). Proxying keeps every
    // fetch same-origin, so there is no CORS layer and no absolute URL in the client.
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
