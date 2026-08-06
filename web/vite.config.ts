import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";
import { createReadStream, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin, ViteDevServer } from "vite";

const monacoEditorPlugin =
  (
    monacoEditorPluginModule as unknown as {
      default?: typeof monacoEditorPluginModule;
    }
  ).default ?? monacoEditorPluginModule;

const PDFJS_RESOURCE_DIRS = ["wasm", "cmaps", "standard_fonts"] as const;
const PDFJS_RESOURCE_DIR_SET = new Set<string>(PDFJS_RESOURCE_DIRS);
const configDir = fileURLToPath(new URL(".", import.meta.url));

function pdfjsStaticAssetsPlugin(): Plugin {
  const pdfjsRoot = join(configDir, "node_modules", "pdfjs-dist");

  return {
    name: "pdfjs-static-assets",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        const url = request.url;
        if (!url) {
          next();
          return;
        }

        const [resourceDir, ...filenameParts] = decodeURIComponent(url)
          .replace(/^\/+/, "")
          .split("/");
        if (!PDFJS_RESOURCE_DIR_SET.has(resourceDir)) {
          next();
          return;
        }

        const filename = filenameParts.join("/");
        if (!filename || filename.indexOf("..") >= 0) {
          next();
          return;
        }

        const filePath = join(pdfjsRoot, resourceDir, filename);
        response.setHeader("Content-Type", contentTypeFor(filePath));
        createReadStream(filePath)
          .on("error", () => next())
          .pipe(response);
      });
    },
    generateBundle() {
      for (const resourceDir of PDFJS_RESOURCE_DIRS) {
        const directory = join(pdfjsRoot, resourceDir);
        for (const filename of readdirSync(directory)) {
          const filePath = join(directory, filename);
          this.emitFile({
            type: "asset",
            fileName: `pdfjs/${resourceDir}/${filename}`,
            source: readFileSync(filePath),
          });
        }
      }
    },
  };
}

function contentTypeFor(filePath: string): string {
  switch (extname(filePath)) {
    case ".wasm":
      return "application/wasm";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".bcmap":
      return "application/octet-stream";
    case ".ttf":
      return "font/ttf";
    case ".pfb":
      return "application/octet-stream";
    default:
      return "application/octet-stream";
  }
}

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ["json"],
    }),
    pdfjsStaticAssetsPlugin(),
  ],
  server: {
    port: 5173,
    fs: {
      allow: [".."],
    },
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
});
