import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
    },
    include: [
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx",
      "packages/**/*.test.ts",
      "evals/**/*.test.ts",
    ],
    exclude: [...configDefaults.exclude, "evals/artifacts/**"],
  },
});
