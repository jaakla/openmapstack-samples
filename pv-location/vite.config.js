import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
export default defineConfig({
  plugins: [react(), analyticsPlugin('pv-location', '6cdeb1e0afb19e2ddc566d5221100a3fb3a13c2d681af5f0beb7d17570c6cc7d')],
  base: "./",
  // These libraries are used on demand. Prepare them before the first area/PDF
  // action so dependency discovery cannot invalidate an in-flight dev import.
  optimizeDeps: { include: ["geotiff", "jspdf", "xlsx"] },
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
