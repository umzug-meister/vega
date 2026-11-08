import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export default defineConfig({
  base: "/",
  plugins: [
    react(),
    {
      name: "vega-admin-service-worker",
      apply: "build",
      generateBundle(_options, bundle) {
        const assets = Object.keys(bundle).filter((name) =>
          /^assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|svg|png|jpe?g|webp)$/u.test(name),
        ).map((name) => `/${name}`).sort();
        const version = createHash("sha256").update(JSON.stringify(assets)).digest("hex").slice(0, 16);
        const template = readFileSync(new URL("./src/pwa/service-worker.js", import.meta.url), "utf8");
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: template.replace("__VEGA_ASSETS__", JSON.stringify(assets)).replace("__VEGA_VERSION__", version),
        });
      },
    },
  ],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/health": "http://127.0.0.1:3000",
    },
  },
});
