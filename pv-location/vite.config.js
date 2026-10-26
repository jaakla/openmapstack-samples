import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  // These libraries are used on demand. Prepare them before the first area/PDF
  // action so dependency discovery cannot invalidate an in-flight dev import.
  optimizeDeps: { include: ["geotiff", "jspdf"] },
  build: {
    chunkSizeWarningLimit: 3000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
