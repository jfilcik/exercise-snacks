import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/.camera-cache/**", "**/.private-camera-fixtures/**"],
    },
  },
  build: {
    rollupOptions: {
      input: { app: resolve("index.html"), coach: resolve("coach.html"), background: resolve("src/background.ts") },
      output: {
        entryFileNames: (chunk) => chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
      },
    },
  },
});
