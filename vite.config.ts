import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  plugins: [react()],
  build: {
    outDir: "dist-renderer"
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:44557",
      "/gif-packs": "http://127.0.0.1:44557",
      "/hook-event": "http://127.0.0.1:44557"
    }
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "dist-electron/**", "dist-renderer/**"]
  }
});
