import basicSsl from "@vitejs/plugin-basic-ssl";
import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: process.env.QUICKEXPORT_NO_SSL === "1" ? [] : [basicSsl()],
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        commands: resolve(__dirname, "commands.html")
      }
    }
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  }
});
