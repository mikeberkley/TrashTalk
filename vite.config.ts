import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  root: "apps/web",
  build: { outDir: "../../dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/m": "http://127.0.0.1:8787",
      "/branding": "http://127.0.0.1:8787",
    },
  },
});
