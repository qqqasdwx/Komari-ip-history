import { defineConfig } from "vite";

const base = process.env.VITE_BASE_PATH ?? "/ipq/";
const allowedHosts = ["localhost", "127.0.0.1", "proxy"];

export default defineConfig({
  base,
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts
  },
  build: {
    outDir: "../public",
    emptyOutDir: true
  }
});
