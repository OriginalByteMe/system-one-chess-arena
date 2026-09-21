import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      // Only the site ships. The design lab at /lab.html is still served by
      // `dev:web` for comparing directions, but it is a throwaway harness and
      // has no business in a production bundle.
      input: { app: "index.html" },
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        ws: true,
      },
    },
  },
});
