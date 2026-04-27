import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const base = process.env.VITE_BASE_PATH ?? "/";
const allowedHosts = ["localhost", "127.0.0.1", "proxy"];
const devPort = Number(process.env.VITE_DEV_PORT || "5173");
const proxyTarget = process.env.VITE_PROXY_TARGET || "http://127.0.0.1:8090";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  server: {
    host: "0.0.0.0",
    port: devPort,
    allowedHosts,
    proxy: {
      "/api": {
        target: proxyTarget,
        changeOrigin: true,
        secure: false
      },
      "/embed": {
        target: proxyTarget,
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: "../public",
    emptyOutDir: true
  }
});
