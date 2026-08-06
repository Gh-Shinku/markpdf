import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      fs: {
        allow: [".."],
      },
    },
  },
});
