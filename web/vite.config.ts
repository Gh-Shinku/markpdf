import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import monacoEditorPluginModule from "vite-plugin-monaco-editor";

const monacoEditorPlugin =
  (
    monacoEditorPluginModule as unknown as {
      default?: typeof monacoEditorPluginModule;
    }
  ).default ?? monacoEditorPluginModule;

export default defineConfig({
  plugins: [
    react(),
    monacoEditorPlugin({
      languageWorkers: ["json"]
    })
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true
      }
    }
  }
});
