import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { analyticsPlugin } from '../shared/vite-analytics.mjs';
import { publicationAttribution } from "./publication.js";
export default defineConfig({
  plugins: [react(), publicationAttribution(), analyticsPlugin('battlefield-visibility', 'c6ec946da4cb946f2c013ba8546505b4687421730c5259da5850cb20dc44930b')],
  build: { target: "es2022" },
});
