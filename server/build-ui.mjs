import { globSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const watch = process.argv.includes("--watch");
const isDevelopment = process.env.NODE_ENV === "development";

const entries = globSync("*.html", { cwd: import.meta.dirname }).map((file) =>
  path.join(import.meta.dirname, file),
);

if (entries.length === 0) {
  throw new Error(
    "No screen entry HTML files found in server/ — add <screen>.html to build a UI screen",
  );
}

function buildScreen(input) {
  return build({
    configFile: false,
    plugins: [react(), viteSingleFile()],
    build: {
      sourcemap: isDevelopment ? "inline" : undefined,
      cssMinify: !isDevelopment,
      minify: !isDevelopment,
      assetsInlineLimit: 1024 * 1024,
      outDir: "dist",
      emptyOutDir: false,
      rollupOptions: { input },
      watch: watch ? {} : null,
    },
  });
}

for (const input of entries) {
  if (watch) {
    void buildScreen(input);
  } else {
    await buildScreen(input);
  }
}
