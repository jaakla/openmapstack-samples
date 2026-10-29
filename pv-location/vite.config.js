import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
export default defineConfig({
  plugins: [react(), analyticsPlugin('pv-location', 'c6ec946da4cb946f2c013ba8546505b4687421730c5259da5850cb20dc44930b')],
  base: "./",
  // These libraries are used on demand. Prepare them before the first area/PDF
  // action so dependency discovery cannot invalidate an in-flight dev import.
  optimizeDeps: { include: ["geotiff", "jspdf", "xlsx"] },
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
