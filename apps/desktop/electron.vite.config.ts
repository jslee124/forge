import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { parseVersion } from "./src/main/update-release.js";

// Only an explicitly supplied release identity may identify a distributable build.
// biome-ignore lint/complexity/useLiteralKeys: ProcessEnv requires indexed access.
const tag = process.env["FORGE_DESKTOP_BUILD_TAG"];
let buildVersion: string | null = null;
if (tag) {
  if (!tag.startsWith("desktop-"))
    throw new Error("Expected desktop-<semver> build tag");
  buildVersion = tag.slice(8);
  const parsed = parseVersion(buildVersion);
  const pkg = JSON.parse(
    readFileSync(new URL("./package.json", import.meta.url), "utf8"),
  );
  if (parsed.core.join(".") !== pkg.version)
    throw new Error("Desktop tag and package version disagree");
}
export default defineConfig({
  main: {
    define: { __FORGE_DESKTOP_VERSION__: JSON.stringify(buildVersion) },
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@forge/application",
          "@forge/core",
          "@forge/persistence",
          "@forge/codex-app-server",
          "@forge/tools",
          "pdfjs-dist",
          "papaparse",
          "zod",
        ],
      }),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/main/index.ts"),
          agent: resolve(import.meta.dirname, "src/agent/index.ts"),
        },
        output: {
          entryFileNames: "[name].js",
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["zod"] })],
    build: {
      rollupOptions: {
        output: {
          entryFileNames: "index.cjs",
          format: "cjs",
        },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
