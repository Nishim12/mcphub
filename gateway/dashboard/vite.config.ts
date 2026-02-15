import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3010",
      "/health": "http://localhost:3010",
      "/stats": "http://localhost:3010",
    },
  },
  base: "/dashboard/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
