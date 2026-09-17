import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// GAME, SEASON, and DB bindings must exist in wrangler.jsonc before this suite runs.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["test-workers/**/*.test.ts"],
  },
});
