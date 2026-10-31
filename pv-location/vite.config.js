import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
export default defineConfig({
  plugins: [react(), analyticsPlugin('pv-location', 'cdd722ab5ded9b55fa614e9969cf46922da66db1e52aeee949e8930ca9db5b07')],
  base: "./",
  // These libraries are used on demand. Prepare them before the first area/PDF
  // action so dependency discovery cannot invalidate an in-flight dev import.
  optimizeDeps: { include: ["geotiff", "jspdf", "xlsx"] },
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
