import { defineConfig } from "vitest/config";

// `npm test`: pure unit tests. `npm run test:rls`: role tests against the local Supabase.
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["src/**/*.test.ts"] } },
      { test: { name: "rls", include: ["tests/**/*.test.ts"], testTimeout: 30_000, hookTimeout: 60_000 } },
    ],
  },
});
