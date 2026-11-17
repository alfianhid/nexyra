import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // The API lives in its own process on 3001 (server/index.ts). Proxying keeps every
    // fetch same-origin, so there is no CORS layer and no absolute URL in the client.
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
