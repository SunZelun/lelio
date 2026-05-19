import { builtinModules } from "node:module";
import path from "node:path";
import { defineConfig } from "vite";
import type { UserConfig } from "vite";

const external = [
  "electron",
  "sqlite",
  "node:sqlite",
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`)
];

const config: UserConfig = {
  build: {
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    target: "node22",
    minify: false,
    rollupOptions: {
      input: {
        "main/main": path.resolve(__dirname, "src/main/main.ts"),
        "preload/preload": path.resolve(__dirname, "src/preload/preload.ts")
      },
      output: {
        format: "cjs",
        entryFileNames: "[name].cjs",
        chunkFileNames: "chunks/[name].cjs"
      },
      external
    }
  }
};

export default defineConfig(config);
