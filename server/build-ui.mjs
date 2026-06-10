import { globSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const watch = process.argv.includes("--watch");
const isDevelopment = process.env.NODE_ENV === "development";

const screens = globSync("*.html", { cwd: import.meta.dirname }).map((file) =>
  path.basename(file, ".html"),
);

if (screens.length === 0) {
  throw new Error(
    "No screen entry HTML files found in server/ — add <screen>.html to build a UI screen",
  );
}

function buildScreen(name) {
  return build({
    configFile: false,
    base: "./",
    plugins: [react()],
    build: {
      sourcemap: isDevelopment ? "inline" : undefined,
      cssCodeSplit: false,
      cssMinify: !isDevelopment,
      minify: !isDevelopment,
      assetsInlineLimit: 1024 * 1024,
      outDir: path.join(import.meta.dirname, "dist", "widgets", name),
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(import.meta.dirname, "ui", `${name}.tsx`),
        output: {
          format: "es",
          entryFileNames: "app.js",
          assetFileNames: "app[extname]",
          inlineDynamicImports: true,
        },
      },
      watch: watch ? {} : null,
    },
  });
}

for (const name of screens) {
  if (watch) {
    void buildScreen(name);
  } else {
    await buildScreen(name);
  }
}
