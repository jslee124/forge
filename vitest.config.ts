import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts"],
  },
});
