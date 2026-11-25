import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/.engine/**"] } },
  build: { target: "es2021", sourcemap: false, chunkSizeWarningLimit: 1500 },
  test: { environment: "jsdom", globals: true },
});
