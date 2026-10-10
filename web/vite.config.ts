import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  server: { port: +(process.env.WEB_PORT || 5173), proxy: { "/api": `http://localhost:${process.env.PORT || 8787}` } },
  build: {
    outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: fileURLToPath(new URL("index.html", import.meta.url)), unit: fileURLToPath(new URL("unit.html", import.meta.url)) } },
  },
});
